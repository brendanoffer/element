import { IPuppeteerClient, launch } from '../../src/driver/Puppeteer'
export { IPuppeteerClient as testPuppeteer }

export async function launchPuppeteer(): Promise<IPuppeteerClient> {
	let opts = {
		sandbox: true,
	}

	if (process.env.NO_CHROME_SANDBOX === '1') {
		opts.sandbox = false
	}

	return launch(opts)
}
