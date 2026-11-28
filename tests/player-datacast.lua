-- Run from the repository root: lua tests/player-datacast.lua
local function read(path)
 local f=assert(io.open(path,'rb'));local s=f:read('*a');f:close();return s
end

local source=read('HttpPublic/api/jklog')
local util=read('HttpPublic/api/util.lua')
local first=assert(util:find('function QuoteCommandArgForPath(',1,true))
local last=assert(util:find('\nend',first,true))+3
local quoteSource=util:sub(first,last)

local function serve(query,win,fail)
 local e=setmetatable({JKRDLOG_PATH='/tools/jkrdlog',WIN32=win or false,query=query,commands={}}, {__index=_G})
 e.dofile=function() end
 assert(load(quoteSource,'QuoteCommandArgForPath','t',e))()
 e.mg={script_name='api/jklog',request_info={query_string=query},get_var=function(q,k) for n,v in pairs(q) do if n:lower()==k:lower() then return v end end;return nil end,
   write=function() end,get_mime_type=function() return 'text/plain' end}
 e.GetVarInt=function(q,k,lo,hi) local n=tonumber(e.mg.get_var(q,k));if n and (not lo or n>=lo) and (not hi or n<=hi) then return n end end
 e.GetFilePath=function() return '/media/movie.mp4' end
 e.IsEqualPath=function(a,b) return a==b end;e.LoadAttachedChapters=function() return nil end
 e.FindToolsCommand=function(n) return n end;e.ReadJikkyoChunk=function() return nil end
 e.CreateContentBuilder=function() return {Append=function(_,s) e.body=(e.body or '')..s end,Finish=function() end,Pop=function(_,s) return s end} end
 e.Response=function(code) e.status=code;return 'HTTP '..code end
 e.edcb={GetPrivateProfile=function(s,k,d) return d end,io={open=function() return nil end,
  popen=function(cmd) e.commands[#e.commands+1]=cmd;return {close=function() end} end},
  os={execute=function(cmd) e.commands[#e.commands+1]=cmd;return #e.commands~=fail end}}
 assert(load(source,'jklog','t',e))()
 return e
end

local e=serve({jkID='1',jkTM='1000',fsec='120'})
assert(e.status==200)
local e=serve({jkid='1',jktm='1000'})
assert(e.status==404)
print('PASS: native log fallback accepts duration and case-insensitive manual parameters')

for _,win in ipairs({false,true}) do
 local e=serve({jkid='1',jktm='1000',fsec='120',kakolog='1'},win)
 assert(e.status==200 and e.body=='done' and #e.commands==2)
 local uri='https://jikkyo.tsukumijima.net/api/kakolog/jk1?starttime=1000&endtime=1120&format=xml'
 assert(e.commands[1]:find(e.QuoteCommandArgForPath(uri),1,true))
 assert(e.commands[1]:find(' --fail --silent --show-error ',1,true))
 assert(not e.commands[1]:find('^&',1,true))
 assert(e.commands[2]:find(e.QuoteCommandArgForPath('/tools/jk1.xml'),1,true))
 local e=serve({jkid='1',jktm='1000',fsec='120',kakolog='1'},win,1)
 assert(e.status==502 and #e.commands==1 and e.body==nil)
 local e=serve({jkid='1',jktm='1000',fsec='120',kakolog='1'},win,2)
 assert(e.status==500 and #e.commands==2 and e.body==nil)
end
print('PASS: Windows/POSIX download arguments, HTTP failure detection, import failure and success responses')
