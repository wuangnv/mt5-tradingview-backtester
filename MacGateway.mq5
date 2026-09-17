//+------------------------------------------------------------------+
//|                                                   MacGateway.mq5 |
//|                                  Copyright 2026, Antigravity AI  |
//|                                             https://google.com   |
//|                                                                  |
//| An Expert Advisor for streaming data from MT5 to Python Flask    |
//| using native MQL5 sockets (perfect for macOS Wine environment).  |
//+------------------------------------------------------------------+
#property copyright "Antigravity AI"
#property link      "https://google.com"
#property version   "1.03"
#property strict

// Inputs
input string   InpServerHost     = "127.0.0.1"; // Python Server Host
input int      InpServerPort     = 9000;        // Python Server Port
input int      InpTimerMs        = 50;          // Timer Interval (ms)

// Global variables
int            g_socket          = INVALID_HANDLE;
string         g_recv_buffer     = "";
uint           g_last_connect_time = 0; // Throttles reconnection to avoid freezing MT5

#include <Trade\Trade.mqh>
CTrade         g_trade;

string JsonEscape(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "\\r");
   StringReplace(value, "\n", "\\n");
   return value;
}

string AccountTradeModeToString(long mode)
{
   if(mode == ACCOUNT_TRADE_MODE_DEMO) return "demo";
   if(mode == ACCOUNT_TRADE_MODE_CONTEST) return "contest";
   if(mode == ACCOUNT_TRADE_MODE_REAL) return "real";
   return "unknown";
}

string BoolJson(bool value)
{
   return value ? "true" : "false";
}

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   Print("=== [MacGateway] Starting Expert Advisor v1.03 ===");
   Print("Connecting to Python Server at " + InpServerHost + ":" + IntegerToString(InpServerPort));
   
   // Set high frequency timer for non-blocking socket checks
   EventSetMillisecondTimer(InpTimerMs);
   
   // Attempt initial connection
   g_last_connect_time = GetTickCount();
   ConnectToServer();
   
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   Print("=== [MacGateway] Stopping Expert Advisor ===");
   EventKillTimer();
   CloseConnection();
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
   // Ticks also trigger socket checks to minimize delay
   CheckSocketData();
}

//+------------------------------------------------------------------+
//| Timer function                                                   |
//+------------------------------------------------------------------+
void OnTimer()
{
   // Check connection status and reconnect if lost (throttled to every 5000ms)
   if(g_socket == INVALID_HANDLE)
   {
      uint current_time = GetTickCount();
      if(current_time - g_last_connect_time >= 5000)
      {
         g_last_connect_time = current_time;
         ConnectToServer();
      }
   }
   else
   {
      CheckSocketData();
   }
}

//+------------------------------------------------------------------+
//| Connect to the Python Socket Server                              |
//+------------------------------------------------------------------+
bool ConnectToServer()
{
   if(g_socket != INVALID_HANDLE)
   {
      CloseConnection();
   }
   
   g_socket = SocketCreate();
   if(g_socket == INVALID_HANDLE)
   {
      Print("[MacGateway] Failed to create socket. Error: ", GetLastError());
      return false;
   }
   
   // Connect with 1000ms timeout
   if(!SocketConnect(g_socket, InpServerHost, InpServerPort, 1000))
   {
      int error_code = GetLastError();
      Print("[MacGateway] Connection to Python Server failed. Error code: ", error_code);
      if(error_code == 4014)
      {
         Print("[MacGateway] ERROR 4014: Function not allowed. Check if 'Allow Algo Trading' is checked in the EA Common settings and globally.");
      }
      else if(error_code == 5272)
      {
         Print("[MacGateway] ERROR 5272: Cannot connect. Make sure Python app.py is running and '127.0.0.1' is in the Tools > Options > Expert Advisors > Allow WebRequest list.");
      }
      SocketClose(g_socket);
      g_socket = INVALID_HANDLE;
      return false;
   }
   
   Print("[MacGateway] Successfully connected to Python server on port ", InpServerPort);
   return true;
}

//+------------------------------------------------------------------+
//| Close socket connection                                          |
//+------------------------------------------------------------------+
void CloseConnection(bool quiet = false)
{
   if(g_socket != INVALID_HANDLE)
   {
      SocketClose(g_socket);
      g_socket = INVALID_HANDLE;
      if(!quiet)
         Print("[MacGateway] Connection closed.");
   }
}

//+------------------------------------------------------------------+
//| Check for incoming socket data (non-blocking)                   |
//+------------------------------------------------------------------+
void CheckSocketData()
{
   if(g_socket == INVALID_HANDLE)
      return;
      
   ResetLastError();
   uint bytes_available = SocketIsReadable(g_socket);
   int readable_error = GetLastError();
   if(bytes_available == 0 && readable_error != 0)
   {
      if(readable_error != 5273)
         Print("[MacGateway] SocketIsReadable error: ", readable_error);
      CloseConnection(readable_error == 5273);
      return;
   }

   if(bytes_available > 0)
   {
      uchar buffer[];
      int bytes_read = SocketRead(g_socket, buffer, bytes_available, 100);
      if(bytes_read > 0)
      {
         string chunk = CharArrayToString(buffer, 0, bytes_read, CP_UTF8);
         g_recv_buffer += chunk;
         
         // Process any complete commands delimited by newline
         int newline_pos;
         while((newline_pos = StringFind(g_recv_buffer, "\n")) >= 0)
         {
            string command = StringSubstr(g_recv_buffer, 0, newline_pos);
            g_recv_buffer = StringSubstr(g_recv_buffer, newline_pos + 1);
            
            StringTrimRight(command);
            StringTrimLeft(command);
            if(StringLen(command) > 0)
            {
               ProcessCommand(command);
            }
         }
      }
      else if(bytes_read == -1)
      {
         int error_code = GetLastError();
         if(error_code != 5273)
            Print("[MacGateway] SocketRead error: ", error_code);
         CloseConnection(error_code == 5273);
      }
   }
}

//+------------------------------------------------------------------+
//| Process received socket command                                  |
//+------------------------------------------------------------------+
void ProcessCommand(string command)
{
   // Parse command and parameters delimited by semicolon ';'
   string parts[];
   int total_parts = StringSplit(command, ';', parts);
   if(total_parts <= 0)
      return;
      
   string cmd_type = parts[0];
   
   if(cmd_type == "GET_SYMBOLS")
   {
      HandleGetSymbols();
   }
   else if(cmd_type == "GET_DATA")
   {
      if(total_parts < 4)
      {
         SendResponse("{\"success\":false,\"message\":\"Invalid GET_DATA parameters\"}");
         return;
      }
      string symbol = parts[1];
      string timeframe = parts[2];
      int bars = (int)StringToInteger(parts[3]);
      HandleGetData(symbol, timeframe, bars);
   }
   else if(cmd_type == "GET_PRICE")
   {
      if(total_parts < 2)
      {
         SendResponse("{\"success\":false,\"message\":\"Invalid GET_PRICE parameters\"}");
         return;
      }
      string symbol = parts[1];
      HandleGetPrice(symbol);
   }
   else if(cmd_type == "GET_EXECUTION_CONTEXT")
   {
      HandleGetExecutionContext();
   }
   else if(cmd_type == "GET_SYMBOL_INFO")
   {
      if(total_parts < 2)
      {
         SendResponse("{\"success\":false,\"message\":\"Invalid GET_SYMBOL_INFO parameters\"}");
         return;
      }
      HandleGetSymbolInfo(parts[1]);
   }
   else if(cmd_type == "TRADE_BUY" || cmd_type == "TRADE_SELL")
   {
      if(total_parts < 5)
      {
         SendResponse("{\"success\":false,\"message\":\"Invalid TRADE parameters\"}");
         return;
      }
      string symbol = parts[1];
      double lots = StringToDouble(parts[2]);
      double sl = StringToDouble(parts[3]);
      double tp = StringToDouble(parts[4]);
      string request_id = total_parts >= 6 ? parts[5] : "";
      HandleTradeOrder(cmd_type == "TRADE_BUY" ? "BUY" : "SELL", symbol, lots, sl, tp, request_id);
   }
   else if(cmd_type == "TRADE_CLOSE")
   {
      if(total_parts < 2)
      {
         SendResponse("{\"success\":false,\"message\":\"Invalid TRADE_CLOSE parameters\"}");
         return;
      }
      ulong ticket = (ulong)StringToInteger(parts[1]);
      string request_id = total_parts >= 3 ? parts[2] : "";
      HandleTradeClose(ticket, request_id);
   }
   else if(cmd_type == "GET_REQUEST")
   {
      if(total_parts < 2)
      {
         SendResponse("{\"success\":false,\"message\":\"Invalid GET_REQUEST parameters\"}");
         return;
      }
      HandleGetRequest(parts[1]);
   }
   else if(cmd_type == "GET_POSITIONS")
   {
      HandleGetPositions();
   }
   else if(cmd_type == "GET_HISTORY")
   {
      int days = 30;
      if(total_parts >= 2)
         days = (int)StringToInteger(parts[1]);
      HandleGetHistory(days);
   }
   else if(cmd_type == "GET_ACCOUNT")
   {
      HandleGetAccount();
   }
   else
   {
      SendResponse("{\"success\":false,\"message\":\"Unknown command: " + cmd_type + "\"}");
   }
}

//+------------------------------------------------------------------+
//| Handle GET_SYMBOLS request                                      |
//+------------------------------------------------------------------+
void HandleGetSymbols()
{
   // Collect selected symbols from Market Watch
   int total = SymbolsTotal(true);
   string symbols_json = "[";
   int count = 0;
   
   for(int i = 0; i < total; i++)
   {
      string name = SymbolName(i, true);
      if(count > 0)
         symbols_json += ",";
      symbols_json += "\"" + name + "\"";
      count++;
   }
   symbols_json += "]";
   
   string response = "{\"success\":true,\"symbols\":" + symbols_json + "}";
   SendResponse(response);
}

//+------------------------------------------------------------------+
//| Map string timeframe to ENUM_TIMEFRAMES                          |
//+------------------------------------------------------------------+
ENUM_TIMEFRAMES GetTimeframeEnum(string tf)
{
   if(tf == "M1") return PERIOD_M1;
   if(tf == "M5") return PERIOD_M5;
   if(tf == "M15") return PERIOD_M15;
   if(tf == "M30") return PERIOD_M30;
   if(tf == "H1") return PERIOD_H1;
   if(tf == "H4") return PERIOD_H4;
   if(tf == "D1") return PERIOD_D1;
   if(tf == "W1") return PERIOD_W1;
   if(tf == "MN1") return PERIOD_MN1;
   return PERIOD_CURRENT;
}

//+------------------------------------------------------------------+
//| Handle GET_DATA request                                         |
//+------------------------------------------------------------------+
void HandleGetData(string symbol, string timeframe, int bars)
{
   ENUM_TIMEFRAMES tf = GetTimeframeEnum(timeframe);
   
   // Enable symbol in Market Watch if not already there
   if(!SymbolSelect(symbol, true))
   {
      SendResponse("{\"success\":false,\"message\":\"Symbol not found or could not be selected: " + symbol + "\",\"data\":[]}");
      return;
   }
   
   MqlRates rates[];
   ArraySetAsSeries(rates, false); // Oldest first, newest last
   
   int copied = CopyRates(symbol, tf, 0, bars, rates);
   if(copied <= 0)
   {
      SendResponse("{\"success\":false,\"message\":\"No data returned for " + symbol + " " + timeframe + ". Error code: " + IntegerToString(GetLastError()) + "\",\"data\":[]}");
      return;
   }

   // Perfect real-time synchronization: Override the last bar close/high/low with the current bid price
   MqlTick tick;
   if(SymbolInfoTick(symbol, tick))
   {
      if(copied > 0)
      {
         rates[copied-1].close = tick.bid;
         if(tick.bid > rates[copied-1].high) rates[copied-1].high = tick.bid;
         if(tick.bid < rates[copied-1].low)  rates[copied-1].low = tick.bid;
      }
   }
   
   // Fast inline JSON construction
   string json = "";
   StringReserve(json, copied * 110 + 256);
   json = "{\"success\":true,\"symbol\":\"" + symbol + "\",\"timeframe\":\"" + timeframe + "\",\"data\":[";
   for(int i = 0; i < copied; i++)
   {
      if(i > 0)
         json += ",";
         
      // Escape scientific notations and output standard floating decimals
      string s_open = DoubleToString(rates[i].open, 5);
      string s_high = DoubleToString(rates[i].high, 5);
      string s_low = DoubleToString(rates[i].low, 5);
      string s_close = DoubleToString(rates[i].close, 5);
      
      json += "{\"time\":" + IntegerToString(rates[i].time) + 
              ",\"open\":" + s_open + 
              ",\"high\":" + s_high + 
              ",\"low\":" + s_low + 
              ",\"close\":" + s_close + 
              ",\"volume\":" + IntegerToString(rates[i].tick_volume) + "}";
   }
   json += "]}";
   
   SendResponse(json);
}

//+------------------------------------------------------------------+
//| Handle GET_PRICE request                                        |
//+------------------------------------------------------------------+
void HandleGetPrice(string symbol)
{
   MqlTick tick;
   if(SymbolInfoTick(symbol, tick))
   {
      datetime server_time = TimeCurrent();
      string response = "{\"success\":true,\"price\":{" + 
                        "\"bid\":" + DoubleToString(tick.bid, 5) + "," + 
                        "\"ask\":" + DoubleToString(tick.ask, 5) + "," + 
                        "\"time\":" + IntegerToString(tick.time) + "," +
                        "\"time_msc\":" + IntegerToString(tick.time_msc) + "," +
                        "\"server_time\":" + IntegerToString(server_time) + "}}";
      SendResponse(response);
   }
   else
   {
      SendResponse("{\"success\":false,\"message\":\"Failed to get tick info for " + symbol + "\"}");
   }
}

//+------------------------------------------------------------------+
//| Return execution identity and hard demo/live safety fields       |
//+------------------------------------------------------------------+
void HandleGetExecutionContext()
{
   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   long trade_mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string server = JsonEscape(AccountInfoString(ACCOUNT_SERVER));
   string company = JsonEscape(AccountInfoString(ACCOUNT_COMPANY));
   string currency = JsonEscape(AccountInfoString(ACCOUNT_CURRENCY));
   bool account_trade_allowed = (bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED);
   bool account_trade_expert = (bool)AccountInfoInteger(ACCOUNT_TRADE_EXPERT);
   bool terminal_connected = (bool)TerminalInfoInteger(TERMINAL_CONNECTED);
   bool terminal_trade_allowed = (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED);
   bool mql_trade_allowed = (bool)MQLInfoInteger(MQL_TRADE_ALLOWED);

   string json = "{\"success\":true,\"protocol_version\":2,\"account\":{" +
                 "\"login\":" + IntegerToString(login) +
                 ",\"server\":\"" + server + "\"" +
                 ",\"company\":\"" + company + "\"" +
                 ",\"currency\":\"" + currency + "\"" +
                 ",\"trade_mode\":\"" + AccountTradeModeToString(trade_mode) + "\"" +
                 ",\"trade_mode_code\":" + IntegerToString(trade_mode) +
                 ",\"trade_allowed\":" + BoolJson(account_trade_allowed) +
                 ",\"trade_expert\":" + BoolJson(account_trade_expert) +
                 "},\"terminal\":{" +
                 "\"connected\":" + BoolJson(terminal_connected) +
                 ",\"trade_allowed\":" + BoolJson(terminal_trade_allowed) +
                 ",\"mql_trade_allowed\":" + BoolJson(mql_trade_allowed) + "}}";
   SendResponse(json);
}

//+------------------------------------------------------------------+
//| Return broker contract fields needed by the P4 risk gate         |
//+------------------------------------------------------------------+
void HandleGetSymbolInfo(string symbol)
{
   if(!SymbolSelect(symbol, true))
   {
      SendResponse("{\"success\":false,\"message\":\"Symbol not found: " + JsonEscape(symbol) + "\"}");
      return;
   }

   long trade_mode = SymbolInfoInteger(symbol, SYMBOL_TRADE_MODE);
   long filling_mode = SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE);
   long execution_mode = SymbolInfoInteger(symbol, SYMBOL_TRADE_EXEMODE);
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   int stops_level = (int)SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double tick_size = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   double tick_value = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
   double volume_min = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double volume_max = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double volume_step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);

   string json = "{\"success\":true,\"symbol\":{" +
                 "\"name\":\"" + JsonEscape(symbol) + "\"" +
                 ",\"trade_mode\":" + IntegerToString(trade_mode) +
                 ",\"trade_allowed\":" + BoolJson(trade_mode != SYMBOL_TRADE_MODE_DISABLED) +
                 ",\"filling_mode\":" + IntegerToString(filling_mode) +
                 ",\"execution_mode\":" + IntegerToString(execution_mode) +
                 ",\"digits\":" + IntegerToString(digits) +
                 ",\"stops_level\":" + IntegerToString(stops_level) +
                 ",\"tick_size\":" + DoubleToString(tick_size, 8) +
                 ",\"tick_value\":" + DoubleToString(tick_value, 8) +
                 ",\"volume_min\":" + DoubleToString(volume_min, 8) +
                 ",\"volume_max\":" + DoubleToString(volume_max, 8) +
                 ",\"volume_step\":" + DoubleToString(volume_step, 8) + "}}";
   SendResponse(json);
}

//+------------------------------------------------------------------+
//| Send response string back to Python server                       |
//+------------------------------------------------------------------+
void SendResponse(string response)
{
   if(g_socket == INVALID_HANDLE)
      return;
      
   string data = response + "\n";
   uchar buffer[];
   int len = StringToCharArray(data, buffer, 0, WHOLE_ARRAY, CP_UTF8);
   int to_send = len - 1; // Exclude the trailing null-character added by MQL5
   
   int total_sent = 0;
   while(total_sent < to_send)
   {
      uchar chunk[];
      int chunk_size = MathMin(to_send - total_sent, 4096);
      if(ArrayCopy(chunk, buffer, 0, total_sent, chunk_size) <= 0)
         break;
         
      int sent = SocketSend(g_socket, chunk, chunk_size);
      if(sent <= 0)
      {
         Print("[MacGateway] SocketSend failed. Error: ", GetLastError());
         CloseConnection();
         break;
      }
      total_sent += sent;
   }
}

//+------------------------------------------------------------------+
//| Handle placing Buy or Sell orders                                |
//+------------------------------------------------------------------+
void HandleTradeOrder(string type, string symbol, double lots, double sl, double tp, string request_id)
{
   g_trade.SetDeviationInPoints(10);
   g_trade.SetTypeFillingBySymbol(symbol);
   
   bool res = false;
   if(type == "BUY")
   {
      res = g_trade.Buy(lots, symbol, 0, sl, tp, request_id);
   }
   else if(type == "SELL")
   {
      res = g_trade.Sell(lots, symbol, 0, sl, tp, request_id);
   }
   
   uint ret_code = g_trade.ResultRetcode();
   bool accepted = res && (ret_code == TRADE_RETCODE_DONE ||
                           ret_code == TRADE_RETCODE_DONE_PARTIAL ||
                           ret_code == TRADE_RETCODE_PLACED);
   if(accepted)
   {
      ulong order_id = g_trade.ResultOrder();
      ulong deal_id = g_trade.ResultDeal();
      ulong position_id = 0;
      if(deal_id > 0 && HistoryDealSelect(deal_id))
         position_id = (ulong)HistoryDealGetInteger(deal_id, DEAL_POSITION_ID);
      double price = g_trade.ResultPrice();
      double filled_volume = g_trade.ResultVolume();
      double remaining_volume = MathMax(0.0, lots - filled_volume);
      string status = ret_code == TRADE_RETCODE_DONE_PARTIAL ? "partial" : "accepted";
      string resp = "{\"success\":true,\"status\":\"" + status + "\",\"message\":\"Order placed successfully\"" +
                    ",\"request_id\":\"" + JsonEscape(request_id) + "\"" +
                    ",\"order_id\":" + IntegerToString(order_id) +
                    ",\"deal_id\":" + IntegerToString(deal_id) +
                    ",\"position_id\":" + IntegerToString(position_id) +
                    ",\"filled_volume\":" + DoubleToString(filled_volume, 8) +
                    ",\"remaining_volume\":" + DoubleToString(remaining_volume, 8) +
                    ",\"price\":" + DoubleToString(price, 5) +
                    ",\"retcode\":" + IntegerToString(ret_code) + "}";
      SendResponse(resp);
   }
   else
   {
      uint error_code = GetLastError();
      string resp = "{\"success\":false,\"status\":\"rejected\",\"request_id\":\"" + JsonEscape(request_id) +
                    "\",\"retcode\":" + IntegerToString(ret_code) +
                    ",\"error\":" + IntegerToString(error_code) +
                    ",\"message\":\"Trade failed\"}";
      SendResponse(resp);
   }
}

//+------------------------------------------------------------------+
//| Handle closing position by ticket                                |
//+------------------------------------------------------------------+
void HandleTradeClose(ulong ticket, string request_id)
{
   if(!PositionSelectByTicket(ticket))
   {
      SendResponse("{\"success\":false,\"status\":\"rejected\",\"request_id\":\"" + JsonEscape(request_id) +
                   "\",\"message\":\"Position not found\"}");
      return;
   }

   string symbol = PositionGetString(POSITION_SYMBOL);
   double volume = PositionGetDouble(POSITION_VOLUME);
   ENUM_POSITION_TYPE position_type = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
   MqlTick tick;
   if(!SymbolInfoTick(symbol, tick))
   {
      SendResponse("{\"success\":false,\"status\":\"rejected\",\"request_id\":\"" + JsonEscape(request_id) +
                   "\",\"message\":\"Failed to read close quote\"}");
      return;
   }

   MqlTradeRequest trade_request = {};
   MqlTradeResult trade_result = {};
   trade_request.action = TRADE_ACTION_DEAL;
   trade_request.position = ticket;
   trade_request.symbol = symbol;
   trade_request.volume = volume;
   trade_request.deviation = 10;
   trade_request.comment = request_id;
   trade_request.type = position_type == POSITION_TYPE_BUY ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
   trade_request.price = trade_request.type == ORDER_TYPE_BUY ? tick.ask : tick.bid;

   long filling = SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE);
   if((filling & SYMBOL_FILLING_FOK) == SYMBOL_FILLING_FOK)
      trade_request.type_filling = ORDER_FILLING_FOK;
   else if((filling & SYMBOL_FILLING_IOC) == SYMBOL_FILLING_IOC)
      trade_request.type_filling = ORDER_FILLING_IOC;
   else
      trade_request.type_filling = ORDER_FILLING_RETURN;

   bool sent = OrderSend(trade_request, trade_result);
   bool accepted = sent && (trade_result.retcode == TRADE_RETCODE_DONE ||
                            trade_result.retcode == TRADE_RETCODE_DONE_PARTIAL ||
                            trade_result.retcode == TRADE_RETCODE_PLACED);
   if(!accepted)
   {
      SendResponse("{\"success\":false,\"status\":\"rejected\",\"request_id\":\"" + JsonEscape(request_id) +
                   "\",\"retcode\":" + IntegerToString(trade_result.retcode) +
                   ",\"message\":\"Close failed\"}");
      return;
   }

   bool still_open = PositionSelectByTicket(ticket);
   string status = "accepted";
   if(trade_result.retcode == TRADE_RETCODE_DONE)
      status = "closed";
   else if(trade_result.retcode == TRADE_RETCODE_DONE_PARTIAL)
      status = "partial";

   double remaining_volume = 0.0;
   if(status == "partial")
   {
      if(still_open)
         remaining_volume = PositionGetDouble(POSITION_VOLUME);
      else
         remaining_volume = MathMax(0.0, volume - trade_result.volume);
   }
   else if(status == "accepted")
      remaining_volume = still_open ? PositionGetDouble(POSITION_VOLUME) : volume;
   SendResponse("{\"success\":true,\"status\":\"" + status + "\",\"request_id\":\"" + JsonEscape(request_id) +
                "\",\"position_id\":" + IntegerToString(ticket) +
                ",\"order_id\":" + IntegerToString(trade_result.order) +
                ",\"deal_id\":" + IntegerToString(trade_result.deal) +
                ",\"filled_volume\":" + DoubleToString(trade_result.volume, 8) +
                ",\"remaining_volume\":" + DoubleToString(remaining_volume, 8) +
                ",\"price\":" + DoubleToString(trade_result.price, 5) +
                ",\"retcode\":" + IntegerToString(trade_result.retcode) + "}");
}

//+------------------------------------------------------------------+
//| Reconcile a durable P4 request from broker-visible comments      |
//+------------------------------------------------------------------+
void HandleGetRequest(string request_id)
{
   string escaped_request = JsonEscape(request_id);

   int position_total = PositionsTotal();
   for(int i = 0; i < position_total; i++)
   {
      ulong position_id = PositionGetTicket(i);
      if(position_id <= 0)
         continue;
      string comment = PositionGetString(POSITION_COMMENT);
      if(comment == request_id || StringFind(comment, request_id) == 0)
      {
         SendResponse("{\"success\":true,\"found\":true,\"status\":\"accepted\",\"request_id\":\"" + escaped_request +
                      "\",\"position_id\":" + IntegerToString(position_id) +
                      ",\"source\":\"position\"}");
         return;
      }
   }

   datetime to_time = TimeCurrent();
   datetime from_time = to_time - 7 * 86400;
   if(HistorySelect(from_time, to_time))
   {
      int deal_total = HistoryDealsTotal();
      for(int i = deal_total - 1; i >= 0; i--)
      {
         ulong deal_id = HistoryDealGetTicket(i);
         if(deal_id <= 0)
            continue;
         string comment = HistoryDealGetString(deal_id, DEAL_COMMENT);
         if(comment != request_id && StringFind(comment, request_id) != 0)
            continue;

         ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal_id, DEAL_ENTRY);
         ulong order_id = (ulong)HistoryDealGetInteger(deal_id, DEAL_ORDER);
         ulong position_id = (ulong)HistoryDealGetInteger(deal_id, DEAL_POSITION_ID);
         string status = (entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY) ? "closed" : "accepted";
         SendResponse("{\"success\":true,\"found\":true,\"status\":\"" + status + "\",\"request_id\":\"" + escaped_request +
                      "\",\"order_id\":" + IntegerToString(order_id) +
                      ",\"deal_id\":" + IntegerToString(deal_id) +
                      ",\"position_id\":" + IntegerToString(position_id) +
                      ",\"volume\":" + DoubleToString(HistoryDealGetDouble(deal_id, DEAL_VOLUME), 8) +
                      ",\"price\":" + DoubleToString(HistoryDealGetDouble(deal_id, DEAL_PRICE), 8) +
                      ",\"source\":\"deal\"}");
         return;
      }

      int order_total = HistoryOrdersTotal();
      for(int i = order_total - 1; i >= 0; i--)
      {
         ulong order_id = HistoryOrderGetTicket(i);
         if(order_id <= 0)
            continue;
         string comment = HistoryOrderGetString(order_id, ORDER_COMMENT);
         if(comment != request_id && StringFind(comment, request_id) != 0)
            continue;

         ulong position_id = (ulong)HistoryOrderGetInteger(order_id, ORDER_POSITION_ID);
         SendResponse("{\"success\":true,\"found\":true,\"status\":\"accepted\",\"request_id\":\"" + escaped_request +
                      "\",\"order_id\":" + IntegerToString(order_id) +
                      ",\"position_id\":" + IntegerToString(position_id) +
                      ",\"source\":\"order\"}");
         return;
      }
   }

   SendResponse("{\"success\":true,\"found\":false,\"status\":\"unknown\",\"request_id\":\"" + escaped_request + "\"}");
}

//+------------------------------------------------------------------+
//| Handle GET_POSITIONS request                                     |
//+------------------------------------------------------------------+
void HandleGetPositions()
{
   int total = PositionsTotal();
   string json = "{\"success\":true,\"positions\":[";
   int count = 0;
   
   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0)
      {
         string symbol = PositionGetString(POSITION_SYMBOL);
         ENUM_POSITION_TYPE type = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
         double volume = PositionGetDouble(POSITION_VOLUME);
         double price_open = PositionGetDouble(POSITION_PRICE_OPEN);
         double price_current = PositionGetDouble(POSITION_PRICE_CURRENT);
         double sl = PositionGetDouble(POSITION_SL);
         double tp = PositionGetDouble(POSITION_TP);
         double profit = PositionGetDouble(POSITION_PROFIT);
         double swap = PositionGetDouble(POSITION_SWAP);
         double commission = 0.0; // POSITION_COMMISSION is deprecated in MQL5
         long time_val = PositionGetInteger(POSITION_TIME);
         
         string pos_type = (type == POSITION_TYPE_BUY) ? "BUY" : "SELL";
         
         if(count > 0)
            json += ",";
            
         json += "{\"ticket\":" + IntegerToString(ticket) + 
                 ",\"symbol\":\"" + symbol + "\"" + 
                 ",\"type\":\"" + pos_type + "\"" + 
                 ",\"volume\":" + DoubleToString(volume, 2) + 
                 ",\"price_open\":" + DoubleToString(price_open, 5) + 
                 ",\"price_current\":" + DoubleToString(price_current, 5) + 
                 ",\"sl\":" + DoubleToString(sl, 5) + 
                 ",\"tp\":" + DoubleToString(tp, 5) + 
                 ",\"profit\":" + DoubleToString(profit, 2) + 
                 ",\"swap\":" + DoubleToString(swap, 2) + 
                 ",\"commission\":" + DoubleToString(commission, 2) + 
                 ",\"time\":" + IntegerToString(time_val) + "}";
         count++;
      }
   }
   json += "]}";
   SendResponse(json);
}

//+------------------------------------------------------------------+
//| Helpers for MT5 history JSON                                     |
//+------------------------------------------------------------------+
string DealTypeToString(ENUM_DEAL_TYPE type)
{
   if(type == DEAL_TYPE_BUY)
      return "BUY";
   if(type == DEAL_TYPE_SELL)
      return "SELL";
   return "OTHER";
}

string DealEntryToString(ENUM_DEAL_ENTRY entry)
{
   if(entry == DEAL_ENTRY_IN)
      return "IN";
   if(entry == DEAL_ENTRY_OUT)
      return "OUT";
   if(entry == DEAL_ENTRY_INOUT)
      return "INOUT";
   if(entry == DEAL_ENTRY_OUT_BY)
      return "OUT_BY";
   return "UNKNOWN";
}

double FindHistoryEntryPrice(ulong position_id, string symbol, double fallback)
{
   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket <= 0)
         continue;

      ulong deal_position_id = (ulong)HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
      string deal_symbol = HistoryDealGetString(ticket, DEAL_SYMBOL);
      ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(ticket, DEAL_ENTRY);

      if(deal_position_id == position_id && deal_symbol == symbol && entry == DEAL_ENTRY_IN)
         return HistoryDealGetDouble(ticket, DEAL_PRICE);
   }

   return fallback;
}

//+------------------------------------------------------------------+
//| Handle GET_HISTORY request                                       |
//+------------------------------------------------------------------+
void HandleGetHistory(int days)
{
   if(days <= 0)
      days = 30;
   if(days > 365)
      days = 365;

   datetime to_time = TimeCurrent();
   datetime from_time = to_time - days * 86400;

   if(!HistorySelect(from_time, to_time))
   {
      uint error_code = GetLastError();
      SendResponse("{\"success\":false,\"message\":\"HistorySelect failed. Error: " + IntegerToString(error_code) + "\"}");
      return;
   }

   int total = HistoryDealsTotal();
   string json = "{\"success\":true,\"history\":[";
   int count = 0;

   for(int i = total - 1; i >= 0 && count < 100; i--)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket <= 0)
         continue;

      ENUM_DEAL_TYPE deal_type = (ENUM_DEAL_TYPE)HistoryDealGetInteger(ticket, DEAL_TYPE);
      if(deal_type != DEAL_TYPE_BUY && deal_type != DEAL_TYPE_SELL)
         continue;

      ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(ticket, DEAL_ENTRY);
      string symbol = HistoryDealGetString(ticket, DEAL_SYMBOL);
      ulong order_id = (ulong)HistoryDealGetInteger(ticket, DEAL_ORDER);
      ulong position_id = (ulong)HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
      long time_val = HistoryDealGetInteger(ticket, DEAL_TIME);
      double volume = HistoryDealGetDouble(ticket, DEAL_VOLUME);
      double price = HistoryDealGetDouble(ticket, DEAL_PRICE);
      double profit = HistoryDealGetDouble(ticket, DEAL_PROFIT);
      double commission = HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      double swap = HistoryDealGetDouble(ticket, DEAL_SWAP);
      double total_profit = profit + commission + swap;

      double price_open = price;
      double price_close = 0.0;
      string result = "Opened";

      if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY)
      {
         price_open = FindHistoryEntryPrice(position_id, symbol, price);
         price_close = price;
         if(total_profit > 0.0)
            result = "Profit";
         else if(total_profit < 0.0)
            result = "Loss";
         else
            result = "Closed";
      }
      else if(entry == DEAL_ENTRY_INOUT)
      {
         price_close = price;
         result = "Reversed";
      }

      if(count > 0)
         json += ",";

      json += "{\"ticket\":" + IntegerToString(ticket) +
              ",\"order\":" + IntegerToString(order_id) +
              ",\"position_id\":" + IntegerToString(position_id) +
              ",\"symbol\":\"" + symbol + "\"" +
              ",\"type\":\"" + DealTypeToString(deal_type) + "\"" +
              ",\"entry\":\"" + DealEntryToString(entry) + "\"" +
              ",\"volume\":" + DoubleToString(volume, 2) +
              ",\"price_open\":" + DoubleToString(price_open, 5) +
              ",\"price_close\":" + DoubleToString(price_close, 5) +
              ",\"profit\":" + DoubleToString(profit, 2) +
              ",\"commission\":" + DoubleToString(commission, 2) +
              ",\"swap\":" + DoubleToString(swap, 2) +
              ",\"profit_total\":" + DoubleToString(total_profit, 2) +
              ",\"result\":\"" + result + "\"" +
              ",\"time\":" + IntegerToString(time_val) + "}";
      count++;
   }

   json += "],\"days\":" + IntegerToString(days) +
           ",\"total_deals\":" + IntegerToString(total) +
           ",\"returned\":" + IntegerToString(count) +
           ",\"message\":\"History scan complete\"}";
   SendResponse(json);
}

//+------------------------------------------------------------------+
//| Handle GET_ACCOUNT request                                       |
//+------------------------------------------------------------------+
void HandleGetAccount()
{
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double margin = AccountInfoDouble(ACCOUNT_MARGIN);
   double free_margin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double margin_level = AccountInfoDouble(ACCOUNT_MARGIN_LEVEL);
   double profit = AccountInfoDouble(ACCOUNT_PROFIT);
   string currency = AccountInfoString(ACCOUNT_CURRENCY);
   string company = AccountInfoString(ACCOUNT_COMPANY);
   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   
   string json = "{\"success\":true,\"account\":{" + 
                 "\"balance\":" + DoubleToString(balance, 2) + 
                 ",\"equity\":" + DoubleToString(equity, 2) + 
                 ",\"margin\":" + DoubleToString(margin, 2) + 
                 ",\"free_margin\":" + DoubleToString(free_margin, 2) + 
                 ",\"margin_level\":" + DoubleToString(margin_level, 2) + 
                 ",\"profit\":" + DoubleToString(profit, 2) + 
                 ",\"currency\":\"" + currency + "\"" + 
                 ",\"company\":\"" + company + "\"" + 
                 ",\"login\":" + IntegerToString(login) + "}}";
                 
   SendResponse(json);
}
