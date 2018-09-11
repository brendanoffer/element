import { join, basename } from 'path'
import { spawn } from 'child_process'
import { sync as globSync } from 'glob'
import chalk from 'chalk'

process.env.DEBUG = 'element-cli:console-reporter'

// run tests
console.log('running tests')

const tests = join(__dirname, 'test-scripts')
let passTests = globSync('*.pass.ts', { cwd: tests, absolute: true })
let failTests = globSync('*.fail.ts', { cwd: tests, absolute: true })
// console.log('pass', passTests)

async function runTest(testScript: string, expectPass: boolean): Promise<boolean> {
	const shortName = basename(testScript)
	console.log('')
	console.log(chalk`{yellow ============ {magenta running test {blue ${shortName}}} ===========}`)
	// console.log(process.env)
	const proc = spawn('element', ['run', testScript, '--chrome', '--verbose'], {
		stdio: ['inherit', 'pipe', 'inherit'],
		env: process.env,
	})

	let passed = true

	proc.stdout.setEncoding('utf8')

	for await (const data of proc.stdout) {
		process.stdout.write(data)
		if (detectError(data)) {
			passed = false
		}
	}

	if (expectPass === passed) {
		console.info(chalk`{green test script {blue ${shortName}} ran as expected}`)
	} else if (expectPass !== passed) {
		console.error(chalk`{red test script {blue ${shortName}} did not run as expected}`)
		console.error(
			chalk`expected to {blue ${expectPass ? 'pass' : 'fail'}} but instead {red ${
				passed ? 'passed' : 'failed'
			}}`,
		)
	}

	return expectPass === passed
}

function detectError(data: string): boolean {
	return /xxxx Step .* failed/.test(data) || /internal flood-chrome error/.test(data)
}
async function runAll() {
	let allExpected = true
	for (const test of passTests) {
		allExpected = (await runTest(test, true)) && allExpected
	}
	for (const test of failTests) {
		allExpected = (await runTest(test, false)) && allExpected
	}

	console.log()
	if (allExpected) {
		console.log(chalk`{green all scripts ran as expected}`)
	} else {
		console.log(chalk`{red not all scripts ran as expected}`)
	}
}

runAll()
