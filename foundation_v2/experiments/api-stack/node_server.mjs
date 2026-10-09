import cluster from 'node:cluster'
import {readFileSync} from 'node:fs'
import Fastify from 'fastify'
import pg from 'pg'

if (cluster.isPrimary) {
  for (let i = 0; i < 4; i++) cluster.fork()
} else {
  const app = Fastify({ logger: false })
  const sql = readFileSync(new URL('./query.sql',import.meta.url),'utf8')
  const pool = new pg.Pool({host:'127.0.0.1',port:Number(process.env.DB_PORT),user:'bench',database:'postgres',max:2})
  const data = []
  for (let i = 1; i <= 100000; i += 2) data.push({id:i,symbol:i%3===0?'EURUSD':'XAUUSD',pnl_cents:(i*17)%20001-10000})
  app.addHook('onRequest', async (request, reply) => {
    if (request.headers['x-workspace-id'] !== 'tenant-a') return reply.code(403).send({detail:'workspace_access_denied'})
  })
  app.get('/json', async () => ({ok:true,scope:'tenant-a'}))
  function params(request, reply) {
    const rows = Number(request.query.rows ?? 100000), page = Number(request.query.page ?? 1)
    if (![10000,100000].includes(rows) || !Number.isInteger(page) || page < 1 || page > 100) {
      reply.code(400).send({detail:'parameters_invalid'}); return null
    }
    return {rows,page}
  }
  app.get('/trades', (request,reply) => {
    const p = params(request,reply); if (!p) return
    const selected = data.filter(item=>item.id<=p.rows&&item.symbol==='EURUSD').sort((a,b)=>b.pnl_cents-a.pnl_cents||a.id-b.id)
    return {total:selected.length,items:selected.slice((p.page-1)*25,p.page*25)}
  })
  app.get('/db', async (request,reply) => {
    const p = params(request,reply); if (!p) return
    const result = await pool.query(sql.replace('{rows}',p.rows).replace('{offset}',(p.page-1)*25))
    return {total:result.rows.length?Number(result.rows[0].total):0,items:result.rows.filter(row=>row.id!==null).map(({id,symbol,pnl_cents})=>({id,symbol,pnl_cents}))}
  })
  await app.listen({host:'127.0.0.1',port:Number(process.env.PORT)})
}
