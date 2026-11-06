import { Account, Client, Functions, Presences, Realtime, Storage, TablesDB, Teams } from 'appwrite';

const endpoint = import.meta.env.VITE_APPWRITE_ENDPOINT as string | undefined;
const project = import.meta.env.VITE_APPWRITE_PROJECT_ID as string | undefined;

/**
 * Подключение к Appwrite. Если в .env нет адреса и id проекта,
 * Fizion работает в офлайн-режиме: всё хранится только на этом компьютере.
 */
const client = endpoint && project ? new Client().setEndpoint(endpoint).setProject(project).setLocale('ru') : null;

export const ONLINE = client !== null;
export const DB = 'fizion';
export const BUCKET = 'files';
export const FUNCTION = 'fizion-api';

export const aw = client
  ? {
      client,
      account: new Account(client),
      db: new TablesDB(client),
      teams: new Teams(client),
      storage: new Storage(client),
      functions: new Functions(client),
      realtime: new Realtime(client),
      presences: new Presences(client),
    }
  : null;
