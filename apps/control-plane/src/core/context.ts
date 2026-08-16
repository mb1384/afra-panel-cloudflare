import type { RoleName } from '@afra/shared';
import type { Bindings } from './env.js';
import type { Logger } from './logger.js';
import type { SettingsService } from './settings.js';

export interface AuthContext {
  adminId: string;
  username: string;
  role: RoleName;
  permissions: string[];
  sessionId: string;
  csrfSecret: string;
}

export interface AppVariables {
  requestId: string;
  settings: SettingsService;
  logger: Logger;
  auth?: AuthContext;
  clientIp: string;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: AppVariables;
}
