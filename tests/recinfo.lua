-- Run from the repository root: lua tests/recinfo.lua. All file operations are virtual.
local f=assert(io.open('HttpPublic/api/SetRecInfo','rb'))
local source=f:read('*a'); f:close()
local function env()
  local e=setmetatable({files={['/old.ts']='video A'},dbpath='/old.ts',moves=0,pathWrites=0}, {__index=_G})
  e.WIN32=true; e.DIR_SEPS='/'
  e.dofile=function() end
  e.mg={script_name='HttpPublic/api/SetRecInfo',request_info={query_string={id='1',json='1'}},get_var=function(q,n) return q and q[n] end}
  e.GetVarInt=function(q,n) return tonumber(q and q[n]) end
  e.AssertPost=function() return e.post or {ren='/new.ts'} end
  e.ResponseJson=function(a) e.result=a end; e.ResponseXml=e.ResponseJson
  e.PathAppend=function(p,n) return p..'/'..n end
  e.IsEqualPath=function(a,b) return a==b end
  e.EdcbFindFilePlain=function(p)
    local v=e.files[p]; if v then return {isdir=type(v)=='table' and v.isdir or false} end
  end
  local function rename(a,b)
    e.moves=e.moves+1
    if e.onMove then e.onMove(a,b) end
    if e.failFrom==a or not e.files[a] or e.files[b] then return false end
    e.files[b]=e.files[a]; e.files[a]=nil; return true
  end
  e.edcb={os={rename=rename},RenameFileNoReplace=rename,
    GetRecFileInfoBasic=function() return {id=1,recFilePath=e.dbpath,protectFlag=e.protected} end,
    GetPrivateProfile=function() return e.infoFolder or '' end,
    ChgProtectRecFileInfo=function(id,value) if e.protectResult~=false then e.protected=value end; return e.protectResult end,
    ChgPathRecFileInfo=function(id,p)
      e.pathWrites=e.pathWrites+1
      if e.onPathWrite then e.onPathWrite() end
      if e.pathResult~=false then e.dbpath=p end
      return e.pathResult
    end}
  return e
end
local function run(e) assert(load(source,'SetRecInfo','t',e))(); return e.result end
for _,value in ipairs({true,false,'legacy'}) do
  local e=env(); e.post={protect='1'}; if value~='legacy' then e.protectResult=value end
  local result=run(e)
  assert((result.success~=nil)==(value~=false))
  assert((result.err~=nil)==(value==false))
end
print('PASS: protection false is an error; true and legacy nil are supported')

local e=env(); e.files['/new.ts']='video B'
assert(run(e).err and e.moves==0 and e.pathWrites==0)
assert(e.files['/old.ts']=='video A' and e.files['/new.ts']=='video B')
e=env(); e.files['/new.ts']={isdir=true}; assert(run(e).err and e.moves==0)
e=env(); e.files['/old.ts']=nil; e.files['/new.ts']='relocated video'; e.files['/old.ts.err']='old log'
assert(run(e).success and e.dbpath=='/new.ts' and e.moves==0 and e.files['/old.ts.err']=='old log')
e=env(); e.post={ren='/old.ts'}; assert(run(e).success and e.moves==0)
print('PASS: collisions/directories are rejected; external path repair and unchanged paths touch no files')

e=env(); e.files['/old.ts.program.txt']='metadata'; e.files['/old.ts.err']='errors'
e.infoFolder='/info'; e.files['/info/old.ts.program.txt']='saved metadata'; e.files['/info/old.ts.err']='saved errors'
assert(run(e).success and e.dbpath=='/new.ts')
assert(e.files['/new.ts']=='video A' and not e.files['/old.ts'])
assert(e.files['/new.ts.program.txt']=='metadata' and e.files['/info/new.ts.err']=='saved errors')
e=env(); e.files['/old.ts.err']='A log'; e.files['/new.ts.err']='B log'
assert(run(e).err and e.moves==0 and e.files['/new.ts.err']=='B log')
print('PASS: video and both sidecar locations move together; sidecar collisions abort before moving')

e=env(); e.files['/old.ts.program.txt']='metadata'; e.pathResult=false
assert(run(e).err and e.dbpath=='/old.ts')
assert(e.files['/old.ts']=='video A' and e.files['/old.ts.program.txt']=='metadata' and not e.files['/new.ts'])
e=env(); e.files['/old.ts.err']='errors'; e.failFrom='/old.ts.err'
assert(run(e).err and e.pathWrites==0 and e.files['/old.ts']=='video A' and not e.files['/new.ts'])
print('PASS: failed history writes or sidecar moves roll back without reporting success')

e=env(); e.onMove=function(a,b) if a=='/old.ts' then e.files[b]='racing file' end end
assert(run(e).err and e.files['/old.ts']=='video A' and e.files['/new.ts']=='racing file' and e.pathWrites==0)
e=env(); e.pathResult=false; e.onPathWrite=function() e.files['/old.ts']='recreated file' end
local result=run(e)
assert(result.err:find('/new.ts',1,true) and e.files['/old.ts']=='recreated file' and e.files['/new.ts']=='video A')
print('PASS: concurrent destination creation and rollback collisions never overwrite existing files')

-- POSIXのos.renameは移動先を上書きする
local function posix(e)
  e.WIN32=false; e.edcb.RenameFileNoReplace=nil
  e.edcb.os.rename=function(a,b)
    e.moves=e.moves+1
    if e.onMove then e.onMove(a,b) end
    if e.failFrom==a or not e.files[a] then return nil,'error' end
    e.files[b]=e.files[a]; e.files[a]=nil; return true
  end
  return e
end
e=posix(env()); e.files['/old.ts.err']='errors'
assert(run(e).success and e.dbpath=='/new.ts' and e.files['/new.ts']=='video A' and e.files['/new.ts.err']=='errors')
e=posix(env()); e.files['/new.ts']='video B'
assert(run(e).err and e.moves==0 and e.files['/new.ts']=='video B')
e=posix(env()); e.pathResult=false; e.onPathWrite=function() e.files['/old.ts']='recreated file' end
result=run(e)
assert(result.err:find('/new.ts',1,true) and e.files['/old.ts']=='recreated file' and e.files['/new.ts']=='video A')
e=env(); e.edcb.RenameFileNoReplace=nil
assert(run(e).success and e.dbpath=='/new.ts')
e=env(); e.files['/old.ts']=nil; e.files['/new.ts']='video'; e.pathResult=false
assert(run(e).err and e.dbpath=='/old.ts' and e.moves==0)
print('PASS: POSIX and Windows fallbacks move without overwriting, and path-repair save failure')
