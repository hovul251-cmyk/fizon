// Нативные штуки Windows:
//  • какое приложение сейчас на переднем плане («Играет в Minecraft») — только если человек разрешил;
//  • удалённое управление в звонке: мышь и клавиатура от собеседника, строго после согласия.
//    Остановить в любой момент: Ctrl+Alt+X (проверяется прямо здесь, а не в браузере), или кнопка в Fizion.
// На других системах команды просто возвращают «недоступно».

use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
pub struct Monitor {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub primary: bool,
}

#[derive(Deserialize)]
pub struct InputEvent {
    /// move | down | up | wheel | key
    pub t: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    /// 0 левая, 1 средняя, 2 правая
    #[serde(default)]
    pub b: u8,
    #[serde(default)]
    pub dy: i32,
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub down: bool,
    #[serde(default)]
    pub text: Option<String>,
}

#[cfg(windows)]
mod win {
    use super::{InputEvent, Monitor};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;
    use tauri::{AppHandle, Emitter};
    use windows_sys::Win32::Foundation::{CloseHandle, BOOL, LPARAM, RECT};
    use windows_sys::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO};
    use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetSystemMetrics, GetWindowThreadProcessId, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN};

    static ENABLED: AtomicBool = AtomicBool::new(false);
    static AREA: Mutex<Option<Monitor>> = Mutex::new(None);
    static APP: OnceLock<AppHandle> = OnceLock::new();

    pub fn init(app: &AppHandle) {
        let _ = APP.set(app.clone());
    }

    /// Имя exe программы на переднем плане (без пути), например "Minecraft.exe"
    pub fn foreground_exe() -> Option<String> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() {
                return None;
            }
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == 0 {
                return None;
            }
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return None;
            }
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len);
            CloseHandle(h);
            if ok == 0 {
                return None;
            }
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            path.rsplit(['\\', '/']).next().map(|s| s.to_string())
        }
    }

    unsafe extern "system" fn on_monitor(m: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
        let list = &mut *(data as *mut Vec<Monitor>);
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(m, &mut info) != 0 {
            let r = info.rcMonitor;
            list.push(Monitor { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top, primary: info.dwFlags & 1 == 1 });
        }
        1
    }

    pub fn monitors() -> Vec<Monitor> {
        let mut list: Vec<Monitor> = Vec::new();
        unsafe {
            EnumDisplayMonitors(std::ptr::null_mut(), std::ptr::null(), Some(on_monitor), &mut list as *mut _ as LPARAM);
        }
        list.sort_by_key(|m| !m.primary);
        list
    }

    fn key_down(vk: u16) -> bool {
        unsafe { (GetAsyncKeyState(vk as i32) as u16 & 0x8000) != 0 }
    }

    pub fn set(enabled: bool, monitor: Option<usize>) {
        if enabled {
            let mons = monitors();
            let m = monitor.and_then(|i| mons.get(i).cloned()).or_else(|| mons.first().cloned());
            *AREA.lock().unwrap() = m;
        }
        let was = ENABLED.swap(enabled, Ordering::SeqCst);
        if enabled && !was {
            // аварийная остановка: Ctrl+Alt+X на этом компьютере
            std::thread::spawn(|| {
                while ENABLED.load(Ordering::SeqCst) {
                    if key_down(VK_CONTROL) && key_down(VK_MENU) && key_down(0x58) {
                        ENABLED.store(false, Ordering::SeqCst);
                        release_all();
                        if let Some(app) = APP.get() {
                            let _ = app.emit("remote-stopped", "hotkey");
                        }
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(40));
                }
            });
        }
        if !enabled {
            release_all();
        }
    }

    /// Отпустить кнопки и модификаторы, чтобы ничего не «залипло» после остановки
    fn release_all() {
        for vk in [VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN] {
            send_key(vk, false);
        }
        send_mouse(MOUSEEVENTF_LEFTUP, 0);
        send_mouse(MOUSEEVENTF_RIGHTUP, 0);
        send_mouse(MOUSEEVENTF_MIDDLEUP, 0);
    }

    fn send(inputs: &[INPUT]) {
        unsafe {
            SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32);
        }
    }

    fn mouse_input(dx: i32, dy: i32, data: i32, flags: u32) -> INPUT {
        let mut i: INPUT = unsafe { std::mem::zeroed() };
        i.r#type = INPUT_MOUSE;
        // колесо мыши может быть отрицательным — в Windows это u32 с тем же набором бит
        i.Anonymous.mi = MOUSEINPUT { dx, dy, mouseData: data as u32, dwFlags: flags, time: 0, dwExtraInfo: 0 };
        i
    }

    fn send_mouse(flags: u32, data: i32) {
        send(&[mouse_input(0, 0, data, flags)]);
    }

    fn send_key(vk: u16, down: bool) {
        let mut i: INPUT = unsafe { std::mem::zeroed() };
        i.r#type = INPUT_KEYBOARD;
        i.Anonymous.ki = KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: if down { 0 } else { KEYEVENTF_KEYUP }, time: 0, dwExtraInfo: 0 };
        send(&[i]);
    }

    fn send_unicode(text: &str) {
        for u in text.encode_utf16() {
            let mut a: INPUT = unsafe { std::mem::zeroed() };
            a.r#type = INPUT_KEYBOARD;
            a.Anonymous.ki = KEYBDINPUT { wVk: 0, wScan: u, dwFlags: KEYEVENTF_UNICODE, time: 0, dwExtraInfo: 0 };
            let mut b = a;
            b.Anonymous.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
            send(&[a, b]);
        }
    }

    /// KeyboardEvent.code из браузера → виртуальная клавиша Windows
    fn vk_of(code: &str) -> Option<u16> {
        if let Some(c) = code.strip_prefix("Key") {
            let b = c.as_bytes();
            if b.len() == 1 && b[0].is_ascii_uppercase() {
                return Some(b[0] as u16);
            }
        }
        if let Some(c) = code.strip_prefix("Digit") {
            let b = c.as_bytes();
            if b.len() == 1 && b[0].is_ascii_digit() {
                return Some(b[0] as u16);
            }
        }
        if let Some(n) = code.strip_prefix('F').and_then(|n| n.parse::<u16>().ok()) {
            if (1..=12).contains(&n) {
                return Some(0x6F + n);
            }
        }
        if let Some(n) = code.strip_prefix("Numpad").and_then(|n| n.parse::<u16>().ok()) {
            if n <= 9 {
                return Some(0x60 + n);
            }
        }
        Some(match code {
            "Enter" | "NumpadEnter" => VK_RETURN,
            "Escape" => VK_ESCAPE,
            "Backspace" => VK_BACK,
            "Tab" => VK_TAB,
            "Space" => VK_SPACE,
            "ShiftLeft" => VK_LSHIFT,
            "ShiftRight" => VK_RSHIFT,
            "ControlLeft" => VK_LCONTROL,
            "ControlRight" => VK_RCONTROL,
            "AltLeft" => VK_LMENU,
            "AltRight" => VK_RMENU,
            "MetaLeft" | "MetaRight" => VK_LWIN,
            "CapsLock" => VK_CAPITAL,
            "ArrowUp" => VK_UP,
            "ArrowDown" => VK_DOWN,
            "ArrowLeft" => VK_LEFT,
            "ArrowRight" => VK_RIGHT,
            "Delete" => VK_DELETE,
            "Insert" => VK_INSERT,
            "Home" => VK_HOME,
            "End" => VK_END,
            "PageUp" => VK_PRIOR,
            "PageDown" => VK_NEXT,
            "Minus" => VK_OEM_MINUS,
            "Equal" => VK_OEM_PLUS,
            "BracketLeft" => VK_OEM_4,
            "BracketRight" => VK_OEM_6,
            "Backslash" => VK_OEM_5,
            "Semicolon" => VK_OEM_1,
            "Quote" => VK_OEM_7,
            "Backquote" => VK_OEM_3,
            "Comma" => VK_OEM_COMMA,
            "Period" => VK_OEM_PERIOD,
            "Slash" => VK_OEM_2,
            "NumpadAdd" => VK_ADD,
            "NumpadSubtract" => VK_SUBTRACT,
            "NumpadMultiply" => VK_MULTIPLY,
            "NumpadDivide" => VK_DIVIDE,
            "NumpadDecimal" => VK_DECIMAL,
            _ => return None,
        })
    }

    pub fn input(ev: InputEvent) -> bool {
        if !ENABLED.load(Ordering::SeqCst) {
            return false;
        }
        let area = AREA.lock().unwrap().clone();
        let Some(m) = area else { return false };
        match ev.t.as_str() {
            "move" | "down" | "up" => {
                let (vx, vy, vw, vh) = unsafe { (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN), GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN)) };
                let px = m.x as f64 + ev.x.clamp(0.0, 1.0) * (m.w - 1) as f64;
                let py = m.y as f64 + ev.y.clamp(0.0, 1.0) * (m.h - 1) as f64;
                let nx = (((px - vx as f64) * 65535.0) / (vw - 1).max(1) as f64).round() as i32;
                let ny = (((py - vy as f64) * 65535.0) / (vh - 1).max(1) as f64).round() as i32;
                let mut list = vec![mouse_input(nx, ny, 0, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK)];
                if ev.t != "move" {
                    let down = ev.t == "down";
                    let flag = match (ev.b, down) {
                        (0, true) => MOUSEEVENTF_LEFTDOWN,
                        (0, false) => MOUSEEVENTF_LEFTUP,
                        (1, true) => MOUSEEVENTF_MIDDLEDOWN,
                        (1, false) => MOUSEEVENTF_MIDDLEUP,
                        (_, true) => MOUSEEVENTF_RIGHTDOWN,
                        (_, false) => MOUSEEVENTF_RIGHTUP,
                    };
                    list.push(mouse_input(0, 0, 0, flag));
                }
                send(&list);
            }
            "wheel" => send_mouse(MOUSEEVENTF_WHEEL, -ev.dy.clamp(-1200, 1200)),
            "key" => {
                if let Some(vk) = vk_of(&ev.code) {
                    send_key(vk, ev.down);
                } else if ev.down {
                    if let Some(t) = ev.text.as_deref() {
                        send_unicode(&t.chars().take(4).collect::<String>());
                    }
                }
            }
            _ => return false,
        }
        true
    }
}

#[tauri::command]
pub fn foreground_app() -> Option<String> {
    #[cfg(windows)]
    return win::foreground_exe();
    #[cfg(not(windows))]
    None
}

#[tauri::command]
pub fn list_monitors() -> Vec<Monitor> {
    #[cfg(windows)]
    return win::monitors();
    #[cfg(not(windows))]
    Vec::new()
}

#[tauri::command]
pub fn remote_set(enabled: bool, monitor: Option<usize>) -> bool {
    #[cfg(windows)]
    {
        win::set(enabled, monitor);
        return true;
    }
    #[cfg(not(windows))]
    {
        let _ = (enabled, monitor);
        false
    }
}

#[tauri::command]
pub fn remote_input(ev: InputEvent) -> bool {
    #[cfg(windows)]
    return win::input(ev);
    #[cfg(not(windows))]
    {
        let _ = ev;
        false
    }
}

#[cfg(windows)]
pub fn init(app: &tauri::AppHandle) {
    win::init(app);
}
#[cfg(not(windows))]
pub fn init(_app: &tauri::AppHandle) {}
