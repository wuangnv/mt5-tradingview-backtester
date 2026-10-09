import autocannon from 'autocannon'
const [url,connections,duration]=process.argv.slice(2)
const result=await autocannon({url,connections:Number(connections),duration:Number(duration),pipelining:1,
  timeout:15,headers:{'X-Workspace-Id':'tenant-a'},workers:Math.min(2,Number(connections))})
process.stdout.write(JSON.stringify(result))
