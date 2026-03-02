import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { DRY_RUN } from '../../config';

export type LogLevel = 'ERROR' | 'WARNING' | 'INFO' | 'SUCCESS';

const LOG_FILE = path.join(process.cwd(), 'volume', 'logs', DRY_RUN ? 'sniper_dryrun.log' : 'sniper.log');
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

// Helpers

function timestamp(): string {
    return new Date().toTimeString().slice(0, 8); // HH:MM:SS
}

// Format details as "key=value key2=value2" — much more readable than JSON
function formatDetails(details: Record<string, unknown>): string {
    const entries = Object.entries(details);
    if (entries.length === 0) return '';
    return '  ' + entries
        .map(([k, v]) => {
            const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
            // Truncate long values to keep console clean
            const short = val.length > 80 ? val.slice(0, 77) + '...' : val;
            return chalk.dim(k + '=') + short;
        })
        .join('  ');
}

// Level config

const LEVEL_CONFIG: Record<LogLevel, { color: chalk.Chalk; emoji: string; label: string }> = {
    ERROR: { color: chalk.red, emoji: '❌', label: 'ERROR  ' },
    WARNING: { color: chalk.yellow, emoji: '⚠️ ', label: 'WARN   ' },
    INFO: { color: chalk.cyan, emoji: '·  ', label: 'INFO   ' },
    SUCCESS: { color: chalk.greenBright, emoji: '✅', label: 'PASS   ' },
};

// Core log function

function log(level: LogLevel, msg: string, details: Record<string, unknown> = {}): void {
    // File: verbose structured JSON
    const fileEntry = {
        level,
        msg,
        ts: Date.now(),
        iso: new Date().toISOString(),
        pid: process.pid,
        dryRun: DRY_RUN,
        ...details,
    };
    fs.appendFileSync(LOG_FILE, JSON.stringify(fileEntry) + '\n');

    // Console: human-readable
    const { color, emoji, label } = LEVEL_CONFIG[level];
    const ts = chalk.gray(`[${timestamp()}]`);
    const dry = DRY_RUN ? chalk.gray('[DRY] ') : '';
    const lvl = color(label);
    const text = color(msg);
    const extra = formatDetails(details);

    console.log(`${ts} ${dry}${emoji}  ${lvl} ${text}${extra}`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const logger = {
    error: (msg: string, details?: Record<string, unknown>) => log('ERROR', msg, details),
    warning: (msg: string, details?: Record<string, unknown>) => log('WARNING', msg, details),
    info: (msg: string, details?: Record<string, unknown>) => log('INFO', msg, details),
    success: (msg: string, details?: Record<string, unknown>) => log('SUCCESS', msg, details),
};