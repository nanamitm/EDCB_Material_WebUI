-- Run from the repository root: lua tests/reservation.lua
local function read(path)
  local f=assert(io.open(path,'rb')); local s=f:read('*a'); f:close(); return s
end
local util=read('HttpPublic/api/util.lua')
local endpoint=read('HttpPublic/api/SetReserve')
local function env()
  local e=setmetatable({}, {__index=_G})
  e.mg={get_var=function(q,n) return q and q[n] end,script_name='HttpPublic/api/SetReserve',request_info={query_string={id='1',json='1'}}}
  for _,names in ipairs({{'GetVarInt','GetVarTime'},{'TimeWithZone',nil},{'GetRecSetting','GetSearchKey'}}) do
    local first=assert(util:find('function '..names[1]..'(',1,true))
    local last=names[2] and assert(util:find('function '..names[2]..'(',first,true)) or assert(util:find('--Windowsかどうか',first,true))
    assert(load(util:sub(first,last-1),names[1],'t',e))()
  end
  local first=assert(endpoint:find('function Program(',1,true))
  local last=assert(endpoint:find('post=AssertPost()',first,true))
  assert(load(endpoint:sub(first,last-1),'Program','t',e))()
  return e
end
local e=env()
local post={recEnabled='1',recMode='1',priority='2',suspendMode='0',useDefMarginFlag='1',tunerID='0',batFilePath='',batFileTag=''}
for _,bits in ipairs({{nil,nil,1},{'1',nil,17},{nil,'1',33},{'1','1',49}}) do
  post.serviceMode_1,post.serviceMode_2=bits[1],bits[2]
  assert(e.GetRecSetting(post).serviceMode==bits[3])
end
post.serviceMode='1'
assert(e.GetRecSetting(post).serviceMode==0)
print('PASS: subtitle/data flags and default service mode')

local function program(startdate,starttime,enddate,endtime)
  e.post={startdate=startdate,starttime=starttime,enddate=enddate,endtime=endtime}
  return e.Program({durationSecond=90000})
end
assert(program('2026-11-28','10:00:00','2026-11-29','11:00:00').durationSecond==90000)
assert(program('2026-11-28','10:00:00','2026-11-29','10:00:00').durationSecond==86400)
assert(program('2026-11-28','10:00:00','2026-11-30','10:00:00').durationSecond==172800)
assert(program('2026-11-28','23:30',nil,'00:30').durationSecond==3600)
assert(program('2026-11-28','10:00','2026-11-28','10:30').durationSecond==1800)
assert(not program('2026-11-28','10:00','2026-11-28','09:00'))
assert(not program('2026-11-28','10:00','2026-11-28','10:00'))
assert(not program('2026-11-28','10:00','2026-11-31','10:00'))
assert(not program('2026-11-28','25:00','2026-11-29','10:00'))
print('PASS: 24/25/48-hour and legacy overnight reservations; invalid dates rejected')

for _,success in ipairs({true,false}) do
  local api=env()
  api.dofile=function() end
  api.AssertPost=function() return {del='1'} end
  api.edcb={GetReserveData=function() return {} end,DelReserveData=function() return success end}
  api.ResponseJson=function(result) api.result=result end
  assert(load(endpoint,'SetReserve','t',api))()
  assert((api.result.success~=nil)==success)
  assert((api.result.err~=nil)==not success)
end
print('PASS: deletion success/failure matches the EDCB result')
