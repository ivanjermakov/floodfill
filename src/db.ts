import { Database, open } from 'sqlite'
import sqlite3 from 'sqlite3'
import { debug } from './log'

export const sql = String.raw

export let db: Database

export const initDb = async (): Promise<Database> => {
    const db_ = await open({ filename: 'database.db', driver: sqlite3.Database })
    db = new Proxy(db_, {
        get: (target, key: string) => {
            const ret = (target as any)[key]
            if (typeof ret !== 'function') return ret

            const start = performance.now()
            return (...args: any[]) => {
                const queryMethods = ['run', 'exec', 'all']
                if (queryMethods.includes(key)) {
                    debug('query', args[0], 'with args', args.slice(1))
                }
                const result = Reflect.apply(ret, db_, args)
                if (queryMethods.includes(key)) {
                    const end = performance.now()
                    debug(`query took ${(end - start).toFixed(2)}ms`)
                }
                return result
            }
        }
    })
    db.on('close', () => debug('db close'))

    debug('initialized')
    return db
}
