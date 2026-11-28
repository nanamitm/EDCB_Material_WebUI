-- Run from the repository root: lua tests/settings-controls.lua
local function read(path)
 local f=assert(io.open(path,'rb'));local s=f:read('*a');f:close();return s
end
local endpoint=read('HttpPublic/api/Settings')
local first=assert(endpoint:find('function GetViewAppCmdOpt()',1,true))
local last=assert(endpoint:find('\nmessage=nil',first,true))
local source=endpoint:sub(first,last-1)
local mutation=endpoint:sub(last+1,assert(endpoint:find('\nif message then',last,true))-1)

local function setup(post)
 local e=setmetatable({post=post or {},INI='HttpPublic.ini',srvIni='EpgTimerSrv.ini',commonIni='Common.ini',appIni='EpgDataCap_Bon.ini',WIN32=false,store={},writes={}}, {__index=_G})
 local function key(s,k,f) return f..'/'..s..'/'..k end
 e.mg={get_var=function(q,k,i) for n,v in pairs(q or {}) do if n:lower()==k:lower() then if type(v)=='table' then return v[(i or 0)+1] end;if not i or i==0 then return v end end end;return nil end}
 e.GetVarInt=function(q,k,lo,hi) local n=tonumber(e.mg.get_var(q,k));if n and n==math.floor(n) and (not lo or n>=lo) and (not hi or n<=hi) then return n end end
 e.PathAppend=function(a,b) return a..'/'..b end;e.EdcbModulePath=function() return '/edcb' end
 e.EdcbSettingPath=function() return '/edcb/Setting' end
 e.IsEqualPath=function(a,b) return a==b end;e.EdcbFindFilePlain=function() return {isdir=true} end
 e.EdcbRecFolderPathList=function() return {'/edcb/Setting'} end
 e.BinarySearch=function(items,k) for _,v in ipairs(items) do if v.id==k.id then return v end end end
 e.CompareFields=function() end
 e.edcb={GetPrivateProfile=function(s,k,d,f) local v=e.store[key(s,k,f)];return v==nil and tostring(d) or v end,
 WritePrivateProfile=function(s,k,v,f) e.writes[#e.writes+1]={section=s,key=k,value=v,file=f};e.store[key(s,k,f)]=type(v)=='boolean' and (v and '1' or '0') or v and tostring(v) or nil;return true end,ReloadSetting=function() e.reloaded=true end}
 assert(load(source,'Settings','t',e))()
 return e
end

local function rs(mode) return {recMode=mode,recFolderList={},partialRecFolder={}} end
for _,selected in ipairs({1,2,0,99}) do
 local e=setup({presetID=tostring(selected),del='1'})
 e.items={{id=0,name='default',recSetting=rs(0)},{id=1,name='A',recSetting=rs(1)},{id=2,name='B',recSetting=rs(2)}}
 e.edcb.EnumRecPresetInfo=function() return e.items end
 e.SavePreset()
 if selected==1 then assert(#e.items==2 and e.items[2].name=='B' and e.items[2].id==1)
 elseif selected==2 then assert(#e.items==2 and e.items[2].name=='A')
 else assert(#e.items==3 and #e.writes==0) end
 assert(e.items[1].name=='default')
end
print('PASS: preset deletion selects the requested entry, preserves default and ignores missing IDs')

local e=setup({epgTime='1380--1-1,11519-15-0'})
e.SaveEpgTime()
local times=e.GetEpgTime()
assert(#times==2 and times[1].weekMin==1380 and times[1].flags==-1 and times[1].enabled)
assert(times[2].weekMin==11519 and times[2].flags==15 and not times[2].enabled)
for _,invalid in ipairs({'1380--2-1','1380-16-1','11520-0-1','broken','1380--1-1,broken'}) do
 local e=setup({srv='1',saveEpg='1',epgTime=invalid});e.ALLOW_SETTING=true
 assert(load(mutation,'Settings mutation','t',e))()
 assert(e.message and #e.writes==0 and not e.reloaded)
end
-- 画面の保存はEpgTimerSrvの各項目を1回の要求で送るため、他の項目も書き込まない
local e=setup({srv='1',saveBasic='1',saveEpg='1',saveRec='1',saveReserve='1',saveOther='1',epgTime='1380-0-1,broken'});e.ALLOW_SETTING=true
for _,name in ipairs({'SaveBasic','SaveRecFolder','SaveBon','SaveEpg','SaveEpgService','SaveRec','SaveNoSuspend','SaveReserve','SaveDelChk','SaveDelExt','SaveOther','SaveViewBon'}) do
 e[name]=function() e.called=(e.called or '')..name..',' end
end
assert(load(mutation,'Settings mutation','t',e))()
assert(e.message and #e.writes==0 and not e.reloaded and e.called==nil, e.called)
print('PASS: default/common EPG schedule survives round trip; invalid schedules do not write or reload')

local e=setup({recFolder={'/recordings','/archive'}})
e.SaveRecFolder()
assert(e.store['Common.ini/SET/RecFolderNum']=='2' and e.store['Common.ini/SET/RecFolderPath0']=='/recordings')
e.post={recFolder={'/edcb/Setting'}};e.SaveRecFolder()
assert(e.store['Common.ini/SET/RecFolderNum']=='0' and not e.store['Common.ini/SET/RecFolderPath0'] and not e.store['Common.ini/SET/RecFolderPath1'])
print('PASS: first custom recording folders save, and returning to the default clears old paths')

for _,tcp in ipairs({false,true}) do
 local e=setup({[tcp and 'tcp' or 'udp']='192.168.1.255:1234:1,::1:2230:0,fe80::1234%eth0:5000:0,::ffff:192.168.1.2:6000:0'})
 e.SaveAppNetwork(tcp)
 local a=e.GetAppNetwork(tcp)
 assert(#a==4 and a[1].ip=='192.168.1.255' and a[1].broadcast==not tcp)
 assert(a[2].ip=='::1' and a[3].ip=='fe80::1234%eth0' and a[4].ip=='::ffff:192.168.1.2')
 local rows={}
 for _,v in ipairs(a) do rows[#rows+1]=v.ip..':'..v.port..':'..(v.broadcast and 1 or 0) end
 e.post={[tcp and 'tcp' or 'udp']=table.concat(rows,',')};e.SaveAppNetwork(tcp)
 local b=e.GetAppNetwork(tcp)
 assert(#b==4 and b[1].broadcast==a[1].broadcast and b[2].ip=='::1')
end
local e=setup({tcp='0.0.0.1:1234:0,0.0.0.2:999:0,[::1]:80:0,0.0.0.0:0:0'})
e.SaveAppNetwork(true)
local a=e.GetAppNetwork(true)
assert(a[1].port==0 and a[2].port==0 and a[3].ip=='::1' and a[4].ip=='0.0.0.0')
print('PASS: IPv4/IPv6/scoped/mapped addresses and UDP broadcast round trip; pipe destinations stay compatible')

for _,invalid in ipairs({'256.1.1.1:1000:0','::1:65536:0','::1:1:2','1:::2:1000:0','1::2::3:1000:0','::1::1::1:1000:0',':1:2:3:4:5:6:7:8:1000:0','::1::1000:0','bad:1000:0',','}) do
 local e=setup({saveApp='1',udp='192.168.1.255:1234:1',tcp=invalid});e.ALLOW_SETTING=true
 assert(load(mutation,'Settings mutation','t',e))()
 assert(e.message and #e.writes==0,invalid)
end
print('PASS: invalid network rows reject the entire application update before any settings are written')

local e=setup()
e.store['HttpPublic.ini/NVRAM/ZIP']='0010000'
assert(e.GetNvram().zip=='0010000')
e.post={nvramZip=e.GetNvram().zip,jkcnslUnixBaseDir='/run/custom',libraryPath='0'}
e.SaveWebUI()
assert(e.GetNvram().zip=='0010000' and e.GetJk().jkcnslUnixBaseDir=='/run/custom')
assert(e.store['HttpPublic.ini/JK/UNIX_BASE_DIR']=='/run/custom')
print('PASS: seven-digit postal codes retain zeros and the jkcnsl Unix directory uses the runtime key')
