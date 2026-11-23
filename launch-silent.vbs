Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
electronExe = appDir & "\node_modules\electron\dist\electron.exe"
WshShell.CurrentDirectory = appDir
If fso.FileExists(electronExe) Then
  WshShell.Run """" & electronExe & """ . --startup", 0, False
Else
  WshShell.Run "cmd /c npm.cmd start -- --startup", 0, False
End If
