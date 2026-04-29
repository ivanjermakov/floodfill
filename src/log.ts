import { format } from 'date-fns'
import { IncomingMessage } from 'http'

export const log = (level: string, stdout: boolean, ...data: any[]): void => {
    const ts = format(new Date(), 'yyyy-MM-dd HH:mm:ss')
    const outFn = stdout ? console.info : console.error
    outFn(`${ts} ${level}`, ...data)
}

export const info = (...data: any[]): void => {
    log('inf', true, ...data)
}

export const warn = (...data: any[]): void => {
    log('wrn', true, ...data)
}

export const debug = (...data: any[]): void => {
    log('dbg', true, ...data)
}

export const error = (...data: any[]): void => {
    log('err', false, ...data)
}

export const request = (req: IncomingMessage): void => {
    const addr = (req.socket && (req.socket.remoteAddress || req.socket.remoteFamily)) || '-'
    const method = req.method || '-'
    const url = req.url || '-'
    debug(`${addr} "${method} ${url}"`)
}

export const assertEqual = <T>(actual: T, expected: T): void => {
    if (actual !== expected) throw Error(`bad assertion:\n  expected: ${expected}\n  actual: ${actual}`)
}

export const assertEqualDeep = <T>(actual: T, expected: T): void => {
    assertEqual(JSON.stringify(actual), JSON.stringify(expected))
}
