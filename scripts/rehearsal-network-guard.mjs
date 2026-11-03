import net from 'node:net'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { allowedTarget } from './rehearsal-safety.mjs'

const ports = (process.env.REHEARSAL_ALLOWED_PORTS ?? '')
  .split(',')
  .map(Number)
  .filter((n) => Number.isInteger(n) && n > 0)
const log = process.env.REHEARSAL_GUARD_LOG
if (!ports.length || !log)
  throw new Error('Rehearsal guard requires explicit ports and violation log.')
const append = fs.appendFileSync.bind(fs)
function deny(reason) {
  append(log, `${reason}\n`)
  throw new Error(`Rehearsal guard: ${reason}`)
}

const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  const options =
    typeof first === 'object' && first !== null
      ? first
      : {
          port: first,
          host: typeof args[1] === 'string' ? args[1] : 'localhost',
        }
  if (
    options.path ||
    !allowedTarget(options.host ?? 'localhost', options.port, ports)
  )
    deny(
      `Blocked non-fixture socket: ${String(options.host ?? 'localhost').replace(/[^a-zA-Z0-9.:[\]-]/g, '?')}:${Number(options.port) || 0}`,
    )
  return connect.apply(this, args)
}

function checkFile(file) {
  const name = file instanceof URL ? fileURLToPath(file) : String(file)
  if (
    basename(name) !== '.env.example' &&
    /^\.env(?:\.|$)/.test(basename(name)) &&
    fs.existsSync(file)
  )
    deny('Blocked private environment file read')
}
const readSync = fs.readFileSync.bind(fs),
  read = fs.readFile.bind(fs),
  readPromise = fs.promises.readFile.bind(fs.promises)
fs.readFileSync = function (file, ...args) {
  checkFile(file)
  return readSync(file, ...args)
}
fs.readFile = function (file, ...args) {
  checkFile(file)
  return read(file, ...args)
}
fs.promises.readFile = async function (file, ...args) {
  checkFile(file)
  return readPromise(file, ...args)
}
syncBuiltinESMExports()
