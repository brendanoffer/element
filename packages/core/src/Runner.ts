import { ConcreteLaunchOptions, PuppeteerClient } from './driver/Puppeteer'
import Test from './runtime/Test'
import { EvaluatedScript } from './runtime/EvaluatedScript'
import { TestObserver } from './runtime/test-observers/Observer'
import { TestSettings } from './runtime/Settings'
import { AsyncFactory } from './utils/Factory'
import { CancellationToken } from './utils/CancellationToken'
import {
	IReporter,
	IterationResult,
	reportRunTest,
	Status,
	StepResult,
} from '@flood/element-report'
import { Looper } from './Looper'
import chalk from 'chalk'

export interface TestCommander {
	on(event: 'rerun-test', listener: () => void): this
}

export interface IRunner {
	run(testScriptFactory: AsyncFactory<EvaluatedScript>): Promise<void>
	stop(): Promise<void>
}

function delay(t: number, v?: any) {
	return new Promise(function(resolve) {
		setTimeout(resolve.bind(null, v), t)
	})
}

export class Runner {
	protected looper: Looper
	running = true
	public clientPromise: Promise<PuppeteerClient> | undefined
	public summaryIteration: IterationResult[] = []

	constructor(
		private clientFactory: AsyncFactory<PuppeteerClient>,
		protected testCommander: TestCommander | undefined,
		private reporter: IReporter,
		private testSettingOverrides: TestSettings,
		private launchOptionOverrides: Partial<ConcreteLaunchOptions>,
		private testObserverFactory: (t: TestObserver) => TestObserver = x => x,
	) {}

	async stop(): Promise<void> {
		this.running = false
		if (this.looper) await this.looper.kill()
		if (this.clientPromise) (await this.clientPromise).close()
		return
	}

	async run(testScriptFactory: AsyncFactory<EvaluatedScript>): Promise<void> {
		const testScript = await testScriptFactory()

		this.clientPromise = this.launchClient(testScript)

		await this.runTestScript(testScript, this.clientPromise)
	}

	async launchClient(testScript: EvaluatedScript): Promise<PuppeteerClient> {
		const { settings } = testScript

		const options: Partial<ConcreteLaunchOptions> = this.launchOptionOverrides
		options.ignoreHTTPSErrors = settings.ignoreHTTPSErrors
		if (settings.viewport) {
			options.defaultViewport = settings.viewport
			settings.device = null
		}
		if (options.chromeVersion == null) options.chromeVersion = settings.chromeVersion

		if (options.args == null) options.args = []
		if (Array.isArray(settings.launchArgs)) options.args.push(...settings.launchArgs)

		return this.clientFactory(options)
	}

	async runTestScript(
		testScript: EvaluatedScript,
		clientPromise: Promise<PuppeteerClient>,
	): Promise<void> {
		if (!this.running) return

		let testToCancel: Test | undefined
		const reportTableData: number[][] = []

		try {
			const test = new Test(
				await clientPromise,
				testScript,
				this.reporter,
				this.testSettingOverrides,
				this.testObserverFactory,
			)
			testToCancel = test

			const { settings } = test

			if (settings.name) {
				console.info(`
*************************************************************
* Loaded test plan: ${settings.name}
* ${settings.description}
*************************************************************
				`)
			}

			await test.beforeRun()

			const cancelToken = new CancellationToken()

			this.looper = new Looper(settings, this.running)
			this.looper.killer = () => cancelToken.cancel()
			let startTime = new Date()
			await this.looper.run(async (iteration: number, isRestart: boolean) => {
				if (isRestart) {
					console.log(`Restarting iteration ${iteration}`)
					this.looper.restartLoopDone()
				} else {
					if (iteration > 1) {
						console.log(chalk.grey('--------------------------------------------'))
					}
					startTime = new Date()
					console.log(`${chalk.bold('\u25CC')} Iteration ${iteration} of ${this.looper.iterations}`)
				}
				try {
					await test.runWithCancellation(iteration, cancelToken, this.looper)
				} finally {
					this.summaryIteration[`Iteration ${iteration}`] = test.summarizeStep()
					if (!this.looper.isRestart) {
						const summarizedData = this.summarizeIteration(iteration, startTime)
						reportTableData.push(summarizedData)
					}
					test.resetSummarizeStep()
				}
			})

			console.log(`Test completed after ${this.looper.iterations} iterations`)
			await test.runningBrowser?.close()
		} catch (err) {
			throw Error(err)
		} finally {
			const table = reportRunTest(reportTableData)
			console.groupEnd()
			console.log(table)
		}

		if (testToCancel !== undefined) {
			await testToCancel.cancel()
		}
	}
	summarizeIteration(iteration: number, startTime: Date): number[] {
		let passedMessage = '',
			failedMessage = '',
			skippedMessage = '',
			unexecutedMessage = ''
		let passedNo = 0,
			failedNo = 0,
			skippedNo = 0,
			unexecutedNo = 0
		const steps: StepResult[] = this.summaryIteration[`Iteration ${iteration}`]
		steps.forEach(step => {
			switch (step.status) {
				case Status.PASSED:
					passedNo += 1
					passedMessage = chalk.green(`${passedNo}`, `${Status.PASSED}`)
					break
				case Status.FAILED:
					failedNo += 1
					failedMessage = chalk.red(`${failedNo}`, `${Status.FAILED}`)
					break
				case Status.SKIPPED:
					skippedNo += 1
					skippedMessage = chalk.yellow(`${skippedNo}`, `${Status.SKIPPED}`)
					break
				case Status.UNEXECUTED:
					unexecutedNo += 1
					unexecutedMessage = chalk(`${unexecutedNo}`, `${Status.UNEXECUTED}`)
					break
			}
		})
		const finallyMessage = chalk(passedMessage, failedMessage, skippedMessage, unexecutedMessage)
		const duration = new Date().valueOf() - startTime.valueOf()
		console.log(`Iteration ${iteration} completed in ${duration}ms (walltime) ${finallyMessage}`)

		return [iteration, passedNo, failedNo, skippedNo, unexecutedNo]
	}
}

export class PersistentRunner extends Runner {
	public testScriptFactory: AsyncFactory<EvaluatedScript> | undefined
	public clientPromise: Promise<PuppeteerClient> | undefined
	private stopped = false

	constructor(
		clientFactory: AsyncFactory<PuppeteerClient>,
		testCommander: TestCommander | undefined,
		reporter: IReporter,
		testSettingOverrides: TestSettings,
		launchOptionOverrides: Partial<ConcreteLaunchOptions>,
		testObserverFactory: (t: TestObserver) => TestObserver = x => x,
	) {
		super(
			clientFactory,
			testCommander,
			reporter,
			testSettingOverrides,
			launchOptionOverrides,
			testObserverFactory,
		)

		if (this.testCommander !== undefined) {
			this.testCommander.on('rerun-test', () => this.rerunTest())
		}
	}

	rerunTest() {
		setImmediate(() => this.runNextTest())
	}

	async runNextTest() {
		// destructure for type checking (narrowing past undefined)
		const { clientPromise, testScriptFactory } = this
		if (clientPromise === undefined) {
			return
		}
		if (testScriptFactory === undefined) {
			return
		}

		if (this.looper) {
			await this.looper.kill()
		}

		try {
			await this.runTestScript(await testScriptFactory(), clientPromise)
		} catch (err) {
			console.error(err.message)
		}
	}

	async stop() {
		this.stopped = true
		this.running = false
		if (this.looper) this.looper.stop()
	}

	async waitUntilStopped(): Promise<void> {
		if (this.stopped) {
			return
		} else {
			await delay(1000)
			return this.waitUntilStopped()
		}
	}

	async run(testScriptFactory: AsyncFactory<EvaluatedScript>): Promise<void> {
		this.testScriptFactory = testScriptFactory

		// TODO detect changes in testScript settings affecting the client
		this.clientPromise = this.launchClient(await testScriptFactory())

		this.rerunTest()
		await this.waitUntilStopped()
		// return new Promise<void>((resolve, reject) => {})
	}
}
