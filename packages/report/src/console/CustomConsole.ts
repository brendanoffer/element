import assert from 'assert'
import { format } from 'util'
import { Console } from 'console'
import { LogCounters, LogMessage, LogTimers, LogType } from '../types/Console'
import chalk from 'chalk'

type Formatter = (type: LogType, message: LogMessage) => string

function simpleFormatter() {
	const TITLE_INDENT = '    '
	const CONSOLE_INDENT = TITLE_INDENT + '  '

	return (type, message) => {
		message = message
			.split(/\n/)
			.map(line => CONSOLE_INDENT + line)
			.join('\n')

		return message + '\n'
	}
}
export class CustomConsole extends Console {
	private _stdout: NodeJS.WriteStream
	private _stderr: NodeJS.WriteStream
	private _formatBuffer: Formatter
	private _counters: LogCounters
	private _timers: LogTimers
	private _groupDepth: number
	public logDepth: number

	constructor(
		stdout: NodeJS.WriteStream,
		stderr: NodeJS.WriteStream,
		formatBuffer: Formatter = (_type: LogType, message: string): string => message,
	) {
		super(stdout, stderr)
		this._stdout = stdout
		this._stderr = stderr
		this._formatBuffer = formatBuffer || simpleFormatter()
		this._counters = {}
		this._timers = {}
		this._groupDepth = 0
		this.logDepth = 0
	}

	private _log(type, message): void {
		this.logDepth++
		if (process.stdout.isTTY) {
			this._stdout.write('\x1b[999D\x1b[K')
		}
		this._stdout.write(
			` ${this.logDepth} ${this._formatBuffer(type, '  '.repeat(this._groupDepth) + message)}`,
		)
	}

	private _logError(type, message): void {
		this.logDepth++
		if (process.stderr.isTTY) {
			this._stderr.write('\x1b[999D\x1b[K')
		}
		this._stderr.write(
			` ${this.logDepth} ${this._formatBuffer(type, '  '.repeat(this._groupDepth) + message)}`,
		)
	}

	assert(value: unknown, message?: string | Error): void {
		try {
			assert(value, message)
		} catch (error) {
			this._logError('assert', error.toString())
		}
	}

	count(label = 'default'): void {
		if (!this._counters[label]) {
			this._counters[label] = 0
		}

		this._log('count', format(`${label}: ${++this._counters[label]}`))
	}

	countReset(label = 'default'): void {
		this._counters[label] = 0
	}

	debug(firstArg: unknown, ...args: Array<unknown>): void {
		this._log('debug', format(firstArg, ...args))
	}
	dir(firstArg: unknown, ...args: Array<unknown>): void {
		this._log('dir', format(firstArg, ...args))
	}

	dirxml(firstArg: unknown, ...args: Array<unknown>): void {
		this._log('dirxml', format(firstArg, ...args))
	}

	error(firstArg: unknown, ...args: Array<unknown>): void {
		this._logError('error', format(firstArg, ...args))
	}

	group(title?: string, ...args: Array<unknown>): void {
		this._groupDepth++

		if (args.length > 0) {
			this._log('group', chalk.bold(format(title, ...args)))
		}
	}
	groupCollapsed(title?: string, ...args: Array<unknown>): void {
		this._groupDepth++

		if (args.length > 0) {
			this._log('groupCollapsed', chalk.bold(format(title, ...args)))
		}
	}

	groupEnd() {
		if (this._groupDepth > 0) {
			this._groupDepth--
		}
	}

	info(firstArg: unknown, ...args: Array<unknown>): void {
		this._log('info', format(firstArg, ...args))
	}

	log(firstArg: unknown, ...args: Array<unknown>): void {
		this._log('log', format(firstArg, ...args))
	}

	time(label = 'default'): void {
		if (this._timers[label]) {
			return
		}

		this._timers[label] = new Date()
	}

	timeEnd(label = 'default'): void {
		const startTime = this._timers[label]

		if (startTime) {
			const endTime = new Date()
			const time = endTime.getTime() - startTime.getTime()
			this._log('time', format(`${label}: ${time}ms`))
			delete this._timers[label]
		}
	}

	warn(firstArg: unknown, ...args: Array<unknown>): void {
		this._log('warn', format(firstArg, ...args))
	}

	getBuffer() {
		return null
	}
}
