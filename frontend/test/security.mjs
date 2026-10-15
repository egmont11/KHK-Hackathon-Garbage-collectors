import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { createServer } from 'vite'

test('production demo queries are ignored; explicit demos have isolated credentials', async () => {
  const source = (await readFile('src/mode.js', 'utf8')).replaceAll('import.meta.env', 'env').replaceAll('export const', 'const')
  const mode = (env, search) => vm.runInNewContext(source + '\n;({DEMO,usingMock,key:storageKey("token")})', { env, location: { search }, URLSearchParams })
  assert.equal(mode({ DEV: false }, '?demo=1&mock=1').usingMock, false)
  assert.equal(mode({ DEV: true }, '?demo=0').DEMO, false)
  assert.equal(mode({ DEV: true }, '?demo=1').key, 'krajanek-demo-token')
  assert.equal(mode({ DEV: false, VITE_DEMO: '1' }, '?demo=1').usingMock, true)
  assert.equal(mode({ DEV: false }, '').key, 'krajanek-token')
})

test('Vite blocks the audited file-read vector, arbitrary origins and unknown hosts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'krajanek-vite-'))
  const sentinel = join(dir, 'sentinel.txt')
  await writeFile(sentinel, 'AUDIT_SENTINEL_PRIVATE_CONTENT')
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, clearScreen: false })
  try {
    await server.listen()
    const port = server.httpServer.address().port
    const base = `http://127.0.0.1:${port}`
    const traversal = await fetch(base + '/@fs' + sentinel + '?import&raw??', { headers: { origin: 'https://attacker.invalid' } })
    assert.equal(traversal.status, 403)
    assert.ok(!(await traversal.text()).includes('AUDIT_SENTINEL_PRIVATE_CONTENT'))
    assert.equal(traversal.headers.get('access-control-allow-origin'), null)
    const source = await fetch(base + '/src/api.js', { headers: { origin: 'https://attacker.invalid' } })
    assert.equal(source.status, 200)
    assert.equal(source.headers.get('access-control-allow-origin'), null)
    // Node fetch ignores a custom Host header; use HTTP so this exercises host validation.
    const hostStatus = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, headers: { host: 'attacker.invalid' } }, (response) => {
        response.resume(); resolve(response.statusCode)
      }).on('error', reject)
    })
    assert.equal(hostStatus, 403)
  } finally { await server.close(); await rm(dir, { recursive: true, force: true }) }
})
