import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
;(async () => {
	const dirName = process.argv.slice(2)[0] ?? 'data/json'
	const files = await readdir(dirName)

	let count = 0

	for (const file of files) {
		if (!file.endsWith('.json')) continue

		const raw = await readFile(join(dirName, file))
		const json: any[] = await JSON.parse(raw.toString())

		count += json.length
	}

	console.log(count)
})()
