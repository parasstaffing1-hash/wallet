Option Explicit

Dim shell, fileSystem, basePath, nodePath, serverPath
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

basePath = fileSystem.GetParentFolderName(WScript.ScriptFullName)
nodePath = basePath & "\node.exe"
serverPath = basePath & "\server.mjs"

shell.Run """" & nodePath & """ """ & serverPath & """", 0, False
WScript.Sleep 1200
shell.Run "http://127.0.0.1:3000/", 1, False
