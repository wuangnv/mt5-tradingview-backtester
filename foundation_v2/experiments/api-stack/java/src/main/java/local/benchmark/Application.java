package local.benchmark;

import java.util.*;
import java.sql.*;
import java.nio.file.*;
import javax.sql.DataSource;
import com.zaxxer.hikari.*;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;

@SpringBootApplication
@RestController
public class Application {
    record Trade(int id, String symbol, int pnl_cents) {}
    static final List<Trade> data = new ArrayList<>();
    static final String sqlTemplate;
    static {try {sqlTemplate=Files.readString(Path.of("query.sql"));} catch (Exception e) {throw new RuntimeException(e);} }
    static { for (int i=1;i<=100000;i+=2) data.add(new Trade(i,i%3==0?"EURUSD":"XAUUSD",(i*17)%20001-10000)); }
    final DataSource pool;
    public Application(DataSource pool) {this.pool=pool;}
    @Bean
    static DataSource datasource() {
        HikariConfig c=new HikariConfig();
        c.setJdbcUrl("jdbc:postgresql://127.0.0.1:"+System.getenv("DB_PORT")+"/postgres");
        c.setUsername("bench");c.setMaximumPoolSize(8);c.setMinimumIdle(8);
        return new HikariDataSource(c);
    }
    static boolean valid(int rows,int page) {return (rows==10000||rows==100000)&&page>=1&&page<=100;}
    @GetMapping("/json")
    ResponseEntity<?> small(@RequestHeader(value="X-Workspace-Id",defaultValue="") String workspace) {
        if (!workspace.equals("tenant-a")) return ResponseEntity.status(403).body(Map.of("detail","workspace_access_denied"));
        return ResponseEntity.ok(Map.of("ok",true,"scope","tenant-a"));
    }
    @GetMapping("/trades")
    ResponseEntity<?> trades(@RequestHeader(value="X-Workspace-Id",defaultValue="") String workspace,@RequestParam(defaultValue="100000") int rows,@RequestParam(defaultValue="1") int page) {
        if (!workspace.equals("tenant-a")) return ResponseEntity.status(403).body(Map.of("detail","workspace_access_denied"));
        if (!valid(rows,page)) return ResponseEntity.badRequest().body(Map.of("detail","parameters_invalid"));
        List<Trade> selected=new ArrayList<>();
        for (Trade t:data) if(t.id<=rows&&t.symbol.equals("EURUSD")) selected.add(t);
        selected.sort(Comparator.comparingInt(Trade::pnl_cents).reversed().thenComparingInt(Trade::id));
        return ResponseEntity.ok(Map.of("total",selected.size(),"items",selected.subList(Math.min((page-1)*25,selected.size()),Math.min(page*25,selected.size()))));
    }
    @GetMapping("/db")
    ResponseEntity<?> database(@RequestHeader(value="X-Workspace-Id",defaultValue="") String workspace,@RequestParam(defaultValue="100000") int rows,@RequestParam(defaultValue="1") int page) throws SQLException {
        if (!workspace.equals("tenant-a")) return ResponseEntity.status(403).body(Map.of("detail","workspace_access_denied"));
        if (!valid(rows,page)) return ResponseEntity.badRequest().body(Map.of("detail","parameters_invalid"));
        String sql=sqlTemplate.replace("{rows}",Integer.toString(rows)).replace("{offset}",Integer.toString((page-1)*25));
        List<Trade> items=new ArrayList<>();long total=0;
        try(Connection c=pool.getConnection();Statement st=c.createStatement();ResultSet rs=st.executeQuery(sql)) {
            while(rs.next()) {total=rs.getLong(4);int id=rs.getInt(1);if(!rs.wasNull()) items.add(new Trade(id,rs.getString(2),rs.getInt(3)));}
        }
        return ResponseEntity.ok(Map.of("total",total,"items",items));
    }
    public static void main(String[] args) {
        SpringApplication app=new SpringApplication(Application.class);
        app.setDefaultProperties(Map.of("server.address","127.0.0.1","server.port",System.getenv("PORT"),"spring.threads.virtual.enabled","true","server.tomcat.max-keep-alive-requests","-1","logging.level.root","ERROR","spring.main.banner-mode","off"));
        app.run(args);
    }
}
