package main

import (
    "context"
    "fmt"
    "os"
    "strconv"
    "slices"
    "strings"
    "github.com/gin-gonic/gin"
    "github.com/gofiber/fiber/v3"
    "github.com/jackc/pgx/v5/pgxpool"
)

type Trade struct { Id int `json:"id"`; Symbol string `json:"symbol"`; Pnl int `json:"pnl_cents"` }
type Page struct { Total int64 `json:"total"`; Items []*Trade `json:"items"` }
var data []*Trade
var pool *pgxpool.Pool
var sqlTemplate string

func handle(path, workspace, rawRows, rawPage string) (int, any) {
    if workspace != "tenant-a" { return 403, gin.H{"detail":"workspace_access_denied"} }
    if path == "/json" { return 200, gin.H{"ok":true,"scope":"tenant-a"} }
    if rawRows == "" { rawRows="100000" }; if rawPage == "" { rawPage="1" }
    rows,err1:=strconv.Atoi(rawRows);page,err2:=strconv.Atoi(rawPage)
    if err1!=nil || err2!=nil || (rows!=10000 && rows!=100000) || page<1 || page>100 { return 400,gin.H{"detail":"parameters_invalid"} }
    result:=Page{Items:make([]*Trade,0,25)}
    if path == "/trades" {
        selected:=make([]*Trade,0)
        for _,item:=range data { if item.Id<=rows && item.Symbol=="EURUSD" { selected=append(selected,item) } }
        slices.SortFunc(selected,func(a,b *Trade) int { if a.Pnl!=b.Pnl { return b.Pnl-a.Pnl };return a.Id-b.Id })
        result.Total=int64(len(selected))
        for i:=(page-1)*25;i<page*25 && i<len(selected);i++ { result.Items=append(result.Items,selected[i]) }
    } else {
        sql:=strings.ReplaceAll(strings.ReplaceAll(sqlTemplate,"{rows}",strconv.Itoa(rows)),"{offset}",strconv.Itoa((page-1)*25))
        records,err:=pool.Query(context.Background(),sql)
        if err!=nil {return 500,gin.H{"detail":"db_error"}}
        defer records.Close()
        for records.Next() { var id *int; var symbol *string; var pnl *int; if err=records.Scan(&id,&symbol,&pnl,&result.Total);err!=nil {return 500,gin.H{"detail":"db_error"}};if id!=nil { result.Items=append(result.Items,&Trade{*id,*symbol,*pnl}) } }
        if records.Err()!=nil {return 500,gin.H{"detail":"db_error"}}
    }
    return 200,result
}

func main() {
    content,readErr:=os.ReadFile("query.sql");if readErr!=nil {panic(readErr)};sqlTemplate=string(content)
    for i:=1;i<=100000;i+=2 {symbol:="XAUUSD";if i%3==0 {symbol="EURUSD"};data=append(data,&Trade{i,symbol,(i*17)%20001-10000})}
    config,err:=pgxpool.ParseConfig(fmt.Sprintf("postgres://bench@127.0.0.1:%s/postgres?sslmode=disable",os.Getenv("DB_PORT")))
    if err!=nil {panic(err)};config.MaxConns=8;config.MinConns=8
    pool,err=pgxpool.NewWithConfig(context.Background(),config);if err!=nil {panic(err)};defer pool.Close()
    addr:="127.0.0.1:"+os.Getenv("PORT")
    if os.Getenv("FRAMEWORK")=="fiber" {
        app:=fiber.New()
        for _,path:=range []string{"/json","/trades","/db"} { app.Get(path,func(c fiber.Ctx) error {status,payload:=handle(c.Path(),c.Get("X-Workspace-Id"),c.Query("rows"),c.Query("page"));return c.Status(status).JSON(payload)}) }
        if err=app.Listen(addr);err!=nil {panic(err)}
    } else {
        gin.SetMode(gin.ReleaseMode);app:=gin.New()
        for _,path:=range []string{"/json","/trades","/db"} { app.GET(path,func(c *gin.Context) {status,payload:=handle(c.Request.URL.Path,c.GetHeader("X-Workspace-Id"),c.Query("rows"),c.Query("page"));c.JSON(status,payload)}) }
        if err=app.Run(addr);err!=nil {panic(err)}
    }
}
