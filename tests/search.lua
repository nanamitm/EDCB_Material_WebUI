-- Run from the repository root: lua tests/search.lua
local function read(path)
  local f=assert(io.open(path,'rb')); local s=f:read('*a'); f:close(); return s
end
local util=read('HttpPublic/api/util.lua')
local function env()
  local e=setmetatable({now=1000000}, {__index=_G})
  local first=assert(util:find('function SearchEpg(',1,true))
  local last=assert(util:find('function ParseAndKey(',first,true))
  assert(load(util:sub(first,last-1),'SearchEpg','t',e))()
  e.os={time=function() return e.now end}
  e.TimeWithZone=function(t) return t.stamp end
  e.CompareStartTimeWithSid=function(a,b) return a.startTime.stamp<b.startTime.stamp end
  e.edcb={SearchEpg=function(key,range) e.range=range; return e.events end,SearchEpgArchive=function(key,range) e.range=range; return e.events end}
  return e
end
local e=env(); local now=e.now+32400
local function event(id,offset,duration)
  return {onid=1,tsid=2,sid=3,eid=id,startTime={stamp=now+offset},durationSecond=duration or 1800}
end
e.events={event(1,-600),event(2,3600),event(3,86400),event(4,10*86400)}
assert(#e.SearchEpg({days=1})==2)
assert(#e.SearchEpg({days=3})==3)
assert(#e.SearchEpg({days=0})==4)
local range={startTime={stamp=now},durationSecond=20*86400}
assert(#e.SearchEpg({days=1},range)==4 and e.range==range)
print('PASS: rolling days=1/3/0 boundaries, ongoing broadcasts and explicit-range precedence')
e.events={event(10,-86400),event(10,-2*86400)}
local results=e.SearchEpg({days=1},range,true)
assert(#results==2 and results[1].archive and results[1].past and results[2].past)
print('PASS: archive events carry both archive and past markers without day truncation')

local endpoint=read('HttpPublic/api/SearchEvent')
local function api(withKey,missing)
  local a=setmetatable({}, {__index=_G})
  a.dofile=function() end
  a.mg={script_name='HttpPublic/api/SearchEvent',request_info={query_string={json='1',preset='1',withKey=withKey}},get_var=function(q,n) return q and q[n] end}
  a.GetVarInt=function(q,n) return tonumber(q and q[n]) end
  a.AssertPost=function() end
  a.GetSearchKeyPreset=function() if not missing then return {andKey='preset keyword',serviceList={{onid=1,tsid=2,sid=3}},days=3} end end
  a.GetSearchKeyKeyword=function() error('must not fall back to an unrestricted keyword search') end
  a.GetVarTimeRange=function() end
  a.SearchEpg=function(key) a.usedKey=key; return {{eid=1}} end
  a.edcb={}
  a.ResponseJson=function(result) a.result=result end
  a.ResponseXml=a.ResponseJson
  assert(load(endpoint,'SearchEvent','t',a))()
  return a
end
local a=api('1')
assert(a.result.items[1].eid==1 and a.result.searchInfo.andKey=='preset keyword')
assert(a.result.searchInfo.days==3 and a.result.searchInfo.serviceList[1].sid==3)
a=api(nil); assert(a.result[1].eid==1 and not a.result.items)
a=api('1',true); assert(a.result.err and not a.usedKey)
print('PASS: opt-in preset conditions match the executed query, old array responses remain compatible, missing presets fail')
