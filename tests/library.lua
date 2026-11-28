-- Run from the repository root: lua tests/library.lua
local function read(path)
 local f=assert(io.open(path,'rb'));local s=f:read('*a');f:close();return s
end
local source=read('HttpPublic/api/Library')
local util=read('HttpPublic/api/util.lua')
local start=assert(util:find('function QuoteCommandArgForPath(',1,true))
local finish=assert(util:find('\nend',start,true))+3
local quoteSource=util:sub(start,finish)

function setup()
 local e=setmetatable({commands={},tree={},query={i='1',json='1'}},{__index=_G})
 e.WIN32=false; e.DIR_SEPS='/'; e.POPEN_BINARY='';e.INI='test'
 e.dofile=function() end
 e.mg={script_name='HttpPublic/api/Library',document_root='/www',request_info={query_string=e.query},md5=function(s) return 'hash:'..s end,
 get_var=function(q,n,i) local v=q and q[n]; if type(v)=='table' then return v[(i or 0)+1] end; if not i or i==0 then return v end end}
 e.GetVarInt=function(q,n,lo,hi) local v=tonumber(e.mg.get_var(q,n));if v and (not lo or v>=lo) and (not hi or v<=hi) then return v end end
 e.GetLibraryPathList=function() return {'/media'} end
 e.Split=function(s) local a={};for v in s:gmatch('[^,]+') do a[#a+1]=v end;return a end
 e.PathAppend=function(a,b) return a..'/'..b end
 e.EdcbModulePath=function() return '/edcb' end
 e.FindToolsCommand=function(n) return n end
 e.EdcbFindFilePlain=function(p) return e.existing and e.existing[p] end
 e.NativeToDocumentPath=function() end
 e.IsEqualPath=function(a,b) return a==b end
 assert(load(quoteSource,'QuoteCommandArgForPath','t',e))()
 e.ConvertSize=function() return 'size' end
 e.GetDurationSec=function() return 30,18800000 end
 e.ResponseJson=function(a) e.result=a end
 e.edcb={GetPrivateProfile=function(section,key,default) return default end,
 FindFile=function(p)
  local dir,pattern=p:match('^(.*)/([^/]*)$');local result={}
  for _,v in ipairs(e.tree[dir] or {}) do
   if pattern=='*' or pattern:sub(1,1)=='*' and v.name:sub(-#pattern+1)==pattern:sub(2) then result[#result+1]=v end
  end;return result
 end,Convert=function(a,b,s) return s end,
 io={open=function(p)
  if e.chapters and e.chapters[p] then
   local c=e.chapters[p]
   return {seek=function(_,mode) if c.seekFail then return nil end; if mode=='end' then return c.size end; return 0 end,
    read=function() return c.text end,close=function() e.closed=(e.closed or 0)+1 end}
  end
  if p==e.video then return {close=function() end} end
 end,popen=function(command)
  e.commands[#e.commands+1]=command
  return {read=function() return '' end,close=function() end}
 end},os={execute=function(command) e.commands[#e.commands+1]=command;return false end}}
 return e
end

local function run(e) assert(load(source,'Library','t',e))() end
for _,parents in ipairs({{'hash:missing'},{'hash:parent','hash:missing'}}) do
 local e=setup()
 e.query.d='hash:target';e.query.p=parents
 e.tree['/media']={{name='parent',isdir=true},{name='target',isdir=true}}
 e.tree['/media/parent']={{name='target',isdir=true}}
 run(e)
 assert(e.result.err and not e.result.dirname)
end
local e=setup()
e.query.d='hash:target';e.query.p={'hash:parent'}
e.tree['/media']={{name='parent',isdir=true}}
e.tree['/media/parent']={{name='target',isdir=true}}
e.tree['/media/parent/target']={}
run(e)
assert(e.result.dirname=='target' and #e.result.path==1 and e.result.path[1].name=='parent')
print('PASS: missing ancestors fail closed and valid folder chains still resolve')

for _,name in ipairs({'episode$(marker).ts','episode`marker`.ts', 'episode\";marker.ts', "episode'quote.ts"}) do
 local e=setup()
 e.query.h='hash:'..name;e.video='/media/'..name
 e.tree['/media']={{name=name,isdir=false}}
 run(e)
 local probe
 for _,cmd in ipairs(e.commands) do if cmd:find(' -s ',1,true) then probe=cmd end end
 assert(probe and probe:find(' '..e.QuoteCommandArgForPath(e.video)..' | ',1,true))
 assert(e.result.path==e.video and e.result.meta.duration==30)
end
print('PASS: TS probe paths use the production shell quoting helper; no commands executed')

for _,chapter in ipairs({{size=1048576},{size=2097152},{seekFail=true},{size=10}}) do
 local e=setup()
 e.query.h='hash:movie.mp4';e.query.basic='0'
 e.tree['/media']={{name='movie.mp4',isdir=false}}
 e.chapters={['/media/chapters/movie.chapter']=chapter}
 run(e)
 assert(e.result.path=='/media/movie.mp4' and not e.result.chapters and e.closed==1)
end
local e=setup()
e.query.h='hash:movie.mp4';e.query.basic='0'
e.tree['/media']={{name='movie.mp4',isdir=false}}
e.chapters={['/media/chapters/movie.chapter']={size=1048576},['/media/movie.chapter']={size=4,text='test'}}
run(e)
assert(e.result.chapters=='test' and e.closed==2)
print('PASS: oversized/unreadable chapters preserve video details and allow valid fallback files')

for _,exists in ipairs({false,true}) do
 local e=setup()
 e.tree['/media']={{name='movie.mp4',isdir=false}}
 if exists then e.existing={['/www/video/thumbs']={isdir=true}} end
 run(e)
 local mkdir,ffmpeg
 for i,cmd in ipairs(e.commands) do
  if cmd=="mkdir -p '/www/video/thumbs'" then mkdir=i end
  if cmd:find('ffmpeg ',1,true) then ffmpeg=i end
 end
 assert(ffmpeg and (exists and not mkdir or not exists and mkdir and mkdir<ffmpeg))
end
print('PASS: automatic thumbnail generation creates an absent output directory before ffmpeg')
