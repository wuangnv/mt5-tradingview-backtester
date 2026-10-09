using Npgsql;
var builder=WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
var app=builder.Build();
var sqlTemplate=File.ReadAllText("query.sql");
var data=Enumerable.Range(1,100000).Where(i=>i%2==1).Select(i=>new Trade(i,i%3==0?"EURUSD":"XAUUSD",(i*17)%20001-10000)).ToArray();
await using var pool=NpgsqlDataSource.Create($"Host=127.0.0.1;Port={Environment.GetEnvironmentVariable("DB_PORT")};Username=bench;Database=postgres;Maximum Pool Size=8;Minimum Pool Size=8;SSL Mode=Disable");
app.Use(async (context,next)=>{
    if (context.Request.Headers["X-Workspace-Id"]!="tenant-a") {context.Response.StatusCode=403;await context.Response.WriteAsJsonAsync(new{detail="workspace_access_denied"});return;}
    await next(context);
});
bool Parameters(HttpRequest req,out int rows,out int page) {
    var a=req.Query["rows"].FirstOrDefault()??"100000";var b=req.Query["page"].FirstOrDefault()??"1";
    var rowValid=int.TryParse(a,out rows);var pageValid=int.TryParse(b,out page);
    return rowValid&&pageValid&&(rows==10000||rows==100000)&&page>=1&&page<=100;
}
app.MapGet("/json",()=>Results.Json(new{ok=true,scope="tenant-a"}));
app.MapGet("/trades",(HttpRequest request)=>{
    if (!Parameters(request,out var rows,out var page)) return Results.BadRequest(new{detail="parameters_invalid"});
    var selected=data.Where(t=>t.id<=rows&&t.symbol=="EURUSD").ToArray();
    Array.Sort(selected,(a,b)=>a.pnl_cents==b.pnl_cents?a.id.CompareTo(b.id):b.pnl_cents.CompareTo(a.pnl_cents));
    return Results.Json(new{total=selected.Length,items=selected.Skip((page-1)*25).Take(25).ToArray()});
});
app.MapGet("/db",async (HttpRequest request)=>{
    if (!Parameters(request,out var rows,out var page)) return Results.BadRequest(new{detail="parameters_invalid"});
    await using var conn=await pool.OpenConnectionAsync();
    await using var command=new NpgsqlCommand(sqlTemplate.Replace("{rows}",rows.ToString()).Replace("{offset}",((page-1)*25).ToString()),conn);
    await using var reader=await command.ExecuteReaderAsync();
    var items=new List<Trade>();long total=0;
    while (await reader.ReadAsync()) {total=reader.GetInt64(3);if (!reader.IsDBNull(0)) items.Add(new Trade(reader.GetInt32(0),reader.GetString(1),reader.GetInt32(2)));}
    return Results.Json(new{total,items});
});
app.Run($"http://127.0.0.1:{Environment.GetEnvironmentVariable("PORT")}");
record Trade(int id,string symbol,int pnl_cents);
