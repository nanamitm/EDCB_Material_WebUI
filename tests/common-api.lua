-- Run from the repository root with Lua 5.2: lua tests/common-api.lua
local file=assert(io.open('HttpPublic/api/util.lua','rb'))
local source=file:read('*a')
file:close()

-- Load the production serializers without initializing EDCB/CivetWeb.
local function loadFunction(name,nextName)
  local first=assert(source:find('function '..name..'(',1,true))
  local last=assert(source:find('function '..nextName..'(',first,true))
  assert(load(source:sub(first,last-1),name))()
end
function EdcbHtmlEscape(s)
  return (s:gsub('&','&amp;'):gsub('<','&lt;'):gsub('>','&gt;'))
end
loadFunction('ConvertXml','ResponseXml')
loadFunction('ConvertJson','ResponseJson')

assert(ConvertXml(false,'enabled')=='<enabled>0</enabled>')
assert(ConvertXml(true,'enabled')=='<enabled>1</enabled>')
assert(ConvertXml(0,'value')=='<value>0</value>')
assert(ConvertXml('<&>','value')=='<value>&lt;&amp;&gt;</value>')
print('PASS: XML booleans and scalar values')

local function checkPlugin(value,name,option)
  local json=ConvertJson({recNamePlugIn=value})
  assert(json:find('"recNamePlugIn":'..ConvertJson(name),1,true),json)
  assert(json:find('"recNameOp":'..ConvertJson(option),1,true),json)
end
for _,platform in ipairs({{true,'dll'},{false,'so'}}) do
  WIN32=platform[1]
  local name='RecName_Macro.'..platform[2]
  checkPlugin(name,name,'')
  checkPlugin(name..'?',name,'')
  checkPlugin(name..'?example?extra',name,'example?extra')
  checkPlugin('','','')
end
print('PASS: Windows/Linux plugins with missing, empty and nonempty options')

WIN32=true
local json=ConvertJson({recFolderList={{recNamePlugIn='RecName_Macro.dll',recFolder='video'}}})
assert(json:find('"recNamePlugIn":"RecName_Macro.dll"',1,true),json)
assert(json:find('"recNameOp":""',1,true),json)
print('PASS: nested recording folder settings retain plugin names')
