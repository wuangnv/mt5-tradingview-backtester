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
#property version   "1.00"
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

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   Print("=== [MacGateway] Starting Expert Advisor ===");
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
void CloseConnection()
{
   if(g_socket != INVALID_HANDLE)
   {
      SocketClose(g_socket);
      g_socket = INVALID_HANDLE;
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
      
   uint bytes_available = SocketIsReadable(g_socket);
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
         Print("[MacGateway] SocketRead error: ", GetLastError());
         CloseConnection();
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
      HandleTradeOrder(cmd_type == "TRADE_BUY" ? "BUY" : "SELL", symbol, lots, sl, tp);
   }
   else if(cmd_type == "TRADE_CLOSE")
   {
      if(total_parts < 2)
      {
         SendResponse("{\"success\":false,\"message\":\"Invalid TRADE_CLOSE parameters\"}");
         return;
      }
      ulong ticket = (ulong)StringToInteger(parts[1]);
      HandleTradeClose(ticket);
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
      string response = "{\"success\":true,\"price\":{" + 
                        "\"bid\":" + DoubleToString(tick.bid, 5) + "," + 
                        "\"ask\":" + DoubleToString(tick.ask, 5) + "," + 
                        "\"time\":" + IntegerToString(tick.time) + "}}";
      SendResponse(response);
   }
   else
   {
      SendResponse("{\"success\":false,\"message\":\"Failed to get tick info for " + symbol + "\"}");
   }
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
void HandleTradeOrder(string type, string symbol, double lots, double sl, double tp)
{
   g_trade.SetDeviationInPoints(10);
   
   bool res = false;
   if(type == "BUY")
   {
      res = g_trade.Buy(lots, symbol, 0, sl, tp);
   }
   else if(type == "SELL")
   {
      res = g_trade.Sell(lots, symbol, 0, sl, tp);
   }
   
   if(res)
   {
      ulong ticket = g_trade.ResultOrder();
      double price = g_trade.ResultPrice();
      string resp = "{\"success\":true,\"message\":\"Order placed successfully\",\"ticket\":" + IntegerToString(ticket) + ",\"price\":" + DoubleToString(price, 5) + "}";
      SendResponse(resp);
   }
   else
   {
      uint error_code = GetLastError();
      uint ret_code = g_trade.ResultRetcode();
      string resp = "{\"success\":false,\"message\":\"Trade failed. RetCode: " + IntegerToString(ret_code) + ", Error: " + IntegerToString(error_code) + "\"}";
      SendResponse(resp);
   }
}

//+------------------------------------------------------------------+
//| Handle closing position by ticket                                |
//+------------------------------------------------------------------+
void HandleTradeClose(ulong ticket)
{
   bool res = g_trade.PositionClose(ticket);
   if(res)
   {
      SendResponse("{\"success\":true,\"message\":\"Position closed successfully\"}");
   }
   else
   {
      uint error_code = GetLastError();
      uint ret_code = g_trade.ResultRetcode();
      SendResponse("{\"success\":false,\"message\":\"Close failed. RetCode: " + IntegerToString(ret_code) + ", Error: " + IntegerToString(error_code) + "\"}");
   }
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

   json += "]}";
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
