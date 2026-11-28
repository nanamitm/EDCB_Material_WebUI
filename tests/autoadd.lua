-- Run from the repository root: lua tests/autoadd.lua
local function read(path)
  local f=assert(io.open(path,'rb')); local s=f:read('*a'); f:close(); return s
end
local util=read('HttpPublic/api/util.lua')
local function env()
  local e=setmetatable({calls=0}, {__index=_G})
  e.mg={script_name='HttpPublic/api/test',request_info={query_string={id='5',json='1'}},get_var=function(q,n) return q and q[n] end}
  e.dofile=function() end
  e.EdcbHtmlEscape=function(s) return s end
  local function loadFunction(first,last)
    local from=assert(util:find('function '..first..'(',1,true))
    local to=assert(util:find('function '..last..'(',from,true))
    assert(load(util:sub(from,to-1),first,'t',e))()
  end
  loadFunction('GetVarInt','GetVarTime')
  loadFunction('GetVarTimeOfDay','GetVarDate')
  loadFunction('GetSearchKey','GetSearchKeyKeyword')
  e.GetRecSetting=function() return {} end
  e.GetVarServiceID=function() return 1,2,3 end
  e.BinarySearch=function() return {serviceName='test'} end
  e.CompareFields=function() end
  e.AssertPost=function() return e.post end
  e.ResponseJson=function(a) e.result=a end
  e.ResponseXml=e.ResponseJson
  e.edcb={GetChDataList=function() return {} end,
    AddOrChgAutoAdd=function(a) e.calls=e.calls+1; e.saved=a; return true end,
    AddOrChgManuAdd=function(a) e.calls=e.calls+1; e.saved=a; return true end}
  return e
end
local function run(e,name)
  assert(load(read('HttpPublic/api/'..name),name,'t',e))()
end
local valid='日-23:30-月-0:30'
for _,dates in ipairs({'日-0:undefined-日-23:59','日-24:0-月-1:0','日-0:60-月-1:0','X-0:0-月-1:0',valid..',bad',valid..','}) do
  local e=env(); e.post={addchg='1',andKey='news',dateList=dates}
  run(e,'SetAutoAdd')
  assert(e.calls==0 and e.result.err and not e.result.success,dates)
  e=env(); e.post={andKey='news',dateList=dates}
  run(e,'SearchEvent')
  assert(e.result.err,dates)
end
for _,dates in ipairs({valid,''}) do
  local e=env(); e.post={addchg='1',andKey='news',dateList=dates}
  run(e,'SetAutoAdd')
  assert(e.calls==1 and e.result.success)
  assert(#e.saved.searchInfo.dateList==(dates=='' and 0 or 1))
end
print('PASS: invalid EPG filters reject the whole update/search; valid and empty filters work')

for _,times in ipairs({{'00:00','01:00',0,3600},{'23:30:00','00:30:00',84600,3600}}) do
  local e=env(); e.post={addchg='1',dayOfWeekFlag='2',startTime=times[1],endTime=times[2],title='test'}
  run(e,'SetManuAdd')
  assert(e.calls==1 and e.result.success)
  assert(e.saved.startTime==times[3] and e.saved.durationSecond==times[4])
  assert(e.saved.dayOfWeekFlag==2 and e.saved.onid==1 and e.saved.sid==3)
end
for _,times in ipairs({{'','01:00'},{'bad','01:00'},{'24:00','01:00'},{'10:60','11:00'},{'10:00:60','11:00'},{'10:00junk','11:00'},{'10:00','10:00:00'}}) do
  local e=env(); e.post={addchg='1',startTime=times[1],endTime=times[2]}
  run(e,'SetManuAdd')
  assert(e.calls==0 and e.result.err and not e.result.success,times[1])
end
local e=env(); e.post={addchg='1',endTime='01:00'}; e.mg.request_info.query_string.json='0'
run(e,'SetManuAdd'); assert(e.calls==0 and e.result.err)
print('PASS: midnight/overnight rules preserve day and service; invalid times never reach EDCB')
