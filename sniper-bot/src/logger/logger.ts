import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { DRY_RUN } from '../../config';

export type LogEvent =
  | 'ERROR'
  | 'WARNING'
  | 'INFO'
  | 'SUCCESS';

interface LogEntry {
  event: LogEvent;
  msg: string;
  [key: string]: unknown;
  ts: number;
}

const LOG_FILE = path.join(process.cwd(), 'logs', 'sniper.log');
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

function log(event: LogEvent, msg: string, details: Record<string, unknown> = {}): void {
    const entry: LogEntry = {
        event,
        msg,
        ts: Date.now(),
        ...details,
    };

    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');

    const prefix = DRY_RUN ? chalk.gray('[DRY] ') : '';
    const line = JSON.stringify(details);
    switch(event) {
        case 'ERROR':
            console.error(prefix + chalk.red('ERROR') + ' ' + msg + '\n' + line);
            break;
        case 'WARNING':
            console.warn(prefix + chalk.yellow('WARNING') + ' ' + msg + '\n' + line);
            break;
        case 'INFO':
            console.info(prefix + chalk.blue('INFO') + ' ' + msg + '\n' + line);
            break;
        case 'SUCCESS':
            console.info(prefix + chalk.green('SUCCESS') + ' ' + msg + '\n' + line);
            break;
    }
}

export const logger = {
    log,
    error: (msg: string, details?: Record<string, unknown>) => log('ERROR', msg, details),
    warning: (msg: string, details?: Record<string, unknown>) => log('WARNING', msg, details),
    info: (msg: string, details?: Record<string, unknown>) => log('INFO', msg, details),
    success: (msg: string, details?: Record<string, unknown>) => log('SUCCESS', msg, details),
};