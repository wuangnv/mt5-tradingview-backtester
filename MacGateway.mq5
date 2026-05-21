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
   // Check connection status and reconnect if lost
   if(g_socket == INVALID_HANDLE || !SocketIsConnected(g_socket))
   {
      ConnectToServer();
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
      // Quietly log, since connection might not be up yet
      // Print("[MacGateway] Connect failed. Error: ", GetLastError());
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
   if(g_socket == INVALID_HANDLE || !SocketIsConnected(g_socket))
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
   int total = SymbolsTotal(false);
   string symbols_json = "[";
   int count = 0;
   
   for(int i = 0; i < total; i++)
   {
      string name = SymbolName(i, false);
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
   
   // Fast inline JSON construction
   string json = "{\"success\":true,\"symbol\":\"" + symbol + "\",\"timeframe\":\"" + timeframe + "\",\"data\":[";
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
   if(g_socket == INVALID_HANDLE || !SocketIsConnected(g_socket))
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
