-- Run from the repository root: lua tests/streaming.lua
local function read(path)
  local f=assert(io.open(path,'rb')); local s=f:read('*a'); f:close(); return s
end
local movie=read('HttpPublic/api/Movie')
local view=read('HttpPublic/api/view')
local ui=read('HttpPublic/E3/util.lua')
local function integer(q,k,lo,hi)
  local n=tonumber(q[k]); if n and n==math.floor(n) and (not lo or n>=lo) and (not hi or n<=hi) then return n end
end
local function serve(headers,method,contents,options)
  options=options or {}
  local e=setmetatable({writes={},body='',closed=0,reads=0,query=options.query or {},position=0}, {__index=_G})
  contents=contents or ('0123456789'):rep(10000)
  e.dofile=function() end; e.GetFilePath=function() return '/media/movie.mp4' end; e.GetVarInt=integer
  e.GetDurationSec=function() return 100,#contents end; e.SeekSec=function() return false end
  e.mg={script_name='api/Movie',request_info={query_string=e.query,request_method=method or 'GET',http_headers=headers or {}},
    get_var=function(q,k) return q[k] end,get_mime_type=function() return 'video/mp4' end,
    write=function(s)
      if #e.writes==0 then e.writes[1]=s; return true end
      e.writes[#e.writes+1]=s;e.body=e.body..s;return not options.cancel
    end}
  e.Response=function(code,mime,charset,length)
    e.code=code;e.length=length
    return 'HTTP '..code..'\r\n'..(length and method~='HEAD' and 'Content-Length: '..length..'\r\n' or '')
  end
  e.edcb={io={open=function()
    if options.missing then return nil end
    return {seek=function(_,mode,n)
      if options.seekFail then return nil end
      e.position=(mode=='end' and #contents or mode=='cur' and e.position+(n or 0) or n or 0);return e.position
    end,read=function(_,n)
      e.reads=e.reads+1;local s=contents:sub(e.position+1,e.position+n);e.position=e.position+#s;return s
    end,close=function() e.closed=e.closed+1 end}
  end}}
  assert(load(movie,'Movie','t',e))()
  return e,contents
end
for _,case in ipairs({
  {'bytes=100-199',100,199}, {'bytes=99990-',99990,99999}, {'bytes=-10',99990,99999},
  {'bytes=99990-999999',99990,99999}, {'bytes=-100001',0,99999}, {'bytes=0-0',0,0}
}) do
  local e,contents=serve({rAnGe=case[1]})
  assert(e.code==206 and e.length==case[3]-case[2]+1 and e.closed==1)
  assert(e.body==contents:sub(case[2]+1,case[3]+1))
  assert(e.writes[1]:find('Content-Range: bytes '..case[2]..'-'..case[3]..'/'..#contents,1,true))
end
for _,range in ipairs({'bytes=100000-','bytes=20-10','bytes=-0','bytes=-','bytes=0-1,4-5','bytes=abc-def'}) do
  local e=serve({Range=range});assert(e.code==416 and e.body=='' and e.closed==1)
  assert(e.writes[1]:find('Content-Range: bytes */100000',1,true))
end
local e=serve({Range='bytes=0-0'},'GET','');assert(e.code==416 and e.body=='')
local e=serve({},'GET','');assert(e.code==200 and e.length==0 and e.body=='')
local e,contents=serve();assert(e.code==200 and e.body==contents and e.closed==1)
local e=serve({Range='bytes=10-19'},'HEAD')
assert(e.code==200 and e.length==100000 and e.reads==0 and e.closed==1)
assert(e.writes[1]:find('Content-Length: 100000',1,true))
local e,contents=serve({Range='bytes=10-19',['If-Range']='unknown'})
assert(e.code==200 and e.body==contents)
local e=serve({},'GET',nil,{cancel=true});assert(e.reads==1 and e.closed==1)
local e=serve({},'GET',nil,{missing=true});assert(e.code==404)
local e=serve({},'GET',nil,{seekFail=true});assert(e.code==404 and e.closed==1)
local e=serve({},'GET',nil,{query={offset='100'}});assert(e.length==0 and e.body=='')
-- offset指定時は切り出した内容を返すため、ブラウザのRange要求を適用しない
local e,contents=serve({Range='bytes=0-'},'GET',nil,{query={offset='50'}})
assert(e.code==200 and not e.writes[1]:find('Content-Range',1,true) and e.writes[1]:find('Accept-Ranges: none',1,true))
assert(#e.body==e.length and e.length<#contents and e.body==contents:sub(#contents-e.length+1))
local e=serve({Range='bytes=0-'})
assert(e.code==206 and e.writes[1]:find('Accept-Ranges: bytes',1,true))
print('PASS: Movie full/HEAD/bounded/open/suffix ranges, clamping, 416, If-Range, cancellation and file failures')

local function startup(stale,hasPipe)
  local e=setmetatable({WIN32=false,DIR_SEPS='/',POPEN_BINARY='',ALLOW_HLS=true,XCODE_BUF=0,
    XCODE_OPTIONS={{filter=':',output={'m2t',''},outputHls={'m2t',''}}},
    query={n='0'},openID=1,terminated=0,closed=0,commands={}}, {__index=_G})
  if hasPipe then e.query.hls='session' end
  e.dofile=function() end; e.AssertPost=function() return hasPipe and {open='1'} or nil end; e.AssertCsrf=function() end
  e.mg={request_info={query_string=e.query,request_method='HEAD'},script_name='api/view',
    get_var=function(q,k) return q[k] end,write=function() end,md5=function() return ('a'):rep(32) end}
  e.GetVarInt=integer;e.GetVarServiceID=function() return 1,2,3 end
  e.TerminateCommandlineLike=function() e.terminated=e.terminated+1 end
  e.SendTSTCPPipePath=function() return 'pipe' end;e.TsmemsegPipePath=function() return 'index' end
  e.OpenTsmemsegPipe=function() return nil end
  e.FindToolsCommand=function(n) return n end;e.PathAppend=function(a,b) return a..'/'..b end
  e.EdcbModulePath=function() return '/edcb' end;e.QuoteCommandArgForPath=function(s) return "'"..s.."'" end
  e.Response=function() return '404' end
  e.edcb={OpenNetworkTV=function() return true,100,1 end,
    IsOpenNetworkTV=function() return true,100,e.openID end,
    FindFile=function(p) if p=='pipe' and hasPipe then return {{name='SendTSTCP_123_100'}} end;return nil end,
    Sleep=function() if stale then e.openID=2 end end,
    CloseNetworkTV=function() e.closed=e.closed+1 end,
    os={execute=function(cmd) e.commands[#e.commands+1]=cmd;return true end}}
  assert(load(view,'view','t',e))()
  return e
end
for _,hasPipe in ipairs({false,true}) do
  local e=startup(true,hasPipe);assert(e.closed==0 and e.terminated==1)
  local e=startup(false,hasPipe);assert(e.closed==1 and e.terminated==(hasPipe and 2 or 1))
end
print('PASS: failed pipe/transcoder startup preserves newer NetworkTV sessions and cleans up owned sessions')

local first=assert(ui:find('function GetPlayerOption(',1,true))
local last=assert(ui:find('\nfunction GetVideoRate(',first,true))
for _,allow in ipairs({false,true}) do
  for _,always in ipairs({false,true}) do
    local e=setmetatable({ALLOW_HLS=allow,ALWAYS_USE_HLS=always,USE_MP4_LLHLS=true,
      ARIBB24_OPTION_JSON='{}',JK_CUSTOM_REPLACE_JSON='{}'}, {__index=_G})
    e.mg={url_encode=function(s) return s end};e.PathToRoot=function() return '../' end
    assert(load(ui:sub(first,last-1),'GetPlayerOption','t',e))()
    local attributes=e.GetPlayerOption()
    assert((attributes:find(' noHls',1,true)~=nil)==not allow)
    assert((attributes:find(' alwaysUseHls',1,true)~=nil)==(allow and always))
    assert((attributes:find(' hls4=',1,true)~=nil)==allow)
    assert(not e.GetPlayerOption(true):find('Hls',1,true))
  end
end
print('PASS: player attributes honor HLS prohibition independently of always-use-HLS and TS-Live')
