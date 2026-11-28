-- Run from the repository root: lua tests/spa-pwa.lua
local function read(path)
  local f=assert(io.open(path,'rb'));local s=f:read('*a');f:close();return s
end
local ui=read('HttpPublic/E3/util.lua')
local util=read('HttpPublic/api/util.lua')
local first=assert(ui:find('function GetAppConfig()',1,true))
local last=assert(ui:find('\nnavList=',first,true))
local jsonFirst=assert(util:find('function ConvertJson(',1,true))
local jsonLast=assert(util:find('\nfunction ResponseJson(',jsonFirst,true))
local name="Bob's \"profile\" & <tag>\nC:\\tools literal &quot;"
local e=setmetatable({
  WIN32=false,INI='HttpPublic.ini',ALLOW_HLS=true,ALWAYS_USE_HLS=true,
  XCODE_OPTIONS={{name=name,outputHls={}},{name='TS',tslive=true,autoCinema=true,deinterlace='bwdif=1',maxRateForDoubling=1}},
  NVRAM_ZIP='0010000',NVRAM_REGION=1,JK_COMMENT_HEIGHT_PERCENT=6,JK_COMMENT_DURATION=5
},{__index=_G})
e.edcb={
  GetPrivateProfile=function(section,key,default)
    if type(default)=='boolean' then return default and '1' or '0' end
    return tostring(default or '')
  end,
  GetChDataList=function() return {} end,
  GetReserveData=function() return {recSetting={serviceMode=1,startMargin=3,endMargin=4}} end
}
e.CsrfToken=function() return 'token"&' end
e.Split=function() return {"O'Reilly",'literal &quot;'} end
e.SelectChDataList=function(v) return v end
e.PathToRoot=function() return '../' end
assert(load(util:sub(jsonFirst,jsonLast-1),'ConvertJson','t',e))()
assert(load(ui:sub(first,last-1),'GetAppConfig','t',e))()
local config=e.GetAppConfig()
assert(config:find('"name":'..e.ConvertJson(name),1,true))
assert(config:find('"searchPresetList":["O\'Reilly","literal &quot;"]',1,true))
assert(config:find('"zip":"0010000"',1,true))
assert(config:find('"useSsePort":false',1,true))
assert(config:find('"tslive":true',1,true))
local attribute=e.GetAppConfigAttribute()
assert(not attribute:find('[<>"]'))
local unescape={['&amp;']='&',['&lt;']='<',['&gt;']='>',['&quot;']='"',['&#39;']="'"}
local decoded=attribute:gsub('&[^;]+;',unescape)
assert(decoded==config)
assert(attribute:find('&amp;quot;',1,true))
print('PASS: app configuration serializes quotes, slashes, newlines and HTML safely with a reversible attribute boundary')
e.XCODE_OPTIONS={};e.Split=function() return {} end
assert(e.GetAppConfig():find('"xcode":[]',1,true))
assert(e.GetAppConfig():find('"searchPresetList":[]',1,true))
assert(read('HttpPublic/E3/index.html'):find('..GetAppConfigAttribute()..',1,true))
print('PASS: empty lists remain arrays and the page uses the escaped configuration attribute')

-- Optional cross-language verification by the external test runner.
SPA_CONFIG_JSON=config
