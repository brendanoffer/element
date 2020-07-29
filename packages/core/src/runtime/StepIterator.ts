import { ConditionFn, RecoverWith, Step, StepRecoveryObject } from './Step'
import { Browser as BrowserInterface } from './IBrowser'
import { Looper } from '../Looper'

export default class StepIterator {
	private steps: Step[]
	private stepCount = 0
	private currentStep: Step

	constructor(allSteps: Step[]) {
		this.steps = allSteps
	}

	get step(): Step {
		return this.currentStep
	}

	goNextStep(): boolean {
		this.stepCount += 1
		return true
	}

	goPreviousStep(): boolean {
		this.stepCount -= 1
		return true
	}

	stepEnd() {
		this.stepCount = this.steps.length
		return true
	}

	async run(iterator: (step: Step) => Promise<void>): Promise<void> {
		while (this.stepCount < this.steps.length) {
			this.currentStep = this.steps[this.stepCount]
			await iterator(this.currentStep)
			this.goNextStep()
		}
	}

	async callCondition(step: Step, iteration: number, browser: BrowserInterface): Promise<boolean> {
		const { once, skip, pending, repeat, stepWhile } = step.options

		if (pending || (once && iteration > 1) || skip) return false

		if (repeat) {
			const { iteration, count } = repeat
			if (iteration >= count - 1) repeat.iteration = 0
			else repeat.iteration += 1
		}

		if (stepWhile) {
			const { predicate } = stepWhile
			return this.callPredicate(predicate, browser)
		}

		return true
	}

	async callPredicate(predicate: ConditionFn, browser: BrowserInterface): Promise<boolean> {
		let condition = false
		try {
			condition = await predicate.call(null, browser)
		} catch (err) {
			console.error(err.message)
		}
		if (!condition) this.goNextStep()
		return condition
	}

	async callRecovery(
		step: Step,
		looper: Looper,
		browser: BrowserInterface,
		recoverySteps: StepRecoveryObject,
		tries: number,
	): Promise<boolean> {
		let stepRecover = recoverySteps[step.name]
		if (!stepRecover) {
			stepRecover = recoverySteps['global']
			if (!stepRecover) return false
		}
		const { recoveryStep, loopCount, iteration } = stepRecover
		const settingRecoveryCount = loopCount || tries || 1
		if (!recoveryStep || iteration >= settingRecoveryCount) {
			stepRecover.iteration = 0
			return false
		}
		stepRecover.iteration += 1
		try {
			const result = await recoveryStep.fn.call(null, browser)
			const { repeat, stepWhile } = step.options
			if (result === RecoverWith.CONTINUE) {
				if (repeat) {
					return this.goPreviousStep()
				}
				return this.goNextStep()
			} else if (result === RecoverWith.RESTART) {
				if (repeat) repeat.iteration = 0
				looper.restartLoop()
				return this.stepEnd()
			} else if (result === RecoverWith.RETRY) {
				if (repeat || stepWhile) {
					if (repeat) repeat.iteration -= 1
					return this.goPreviousStep()
				} else {
					return this.goNextStep()
				}
			}
		} catch (err) {
			return false
		}

		return true
	}
}
