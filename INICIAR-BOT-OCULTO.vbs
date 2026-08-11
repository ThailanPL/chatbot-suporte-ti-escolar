Option Explicit

Dim shell, fso, pastaBot, arquivoServico
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

pastaBot = fso.GetParentFolderName(WScript.ScriptFullName)
arquivoServico = pastaBot & "\INICIAR-SERVICO.bat"

If Not fso.FileExists(arquivoServico) Then
    MsgBox "Arquivo INICIAR-SERVICO.bat não encontrado.", 16, "Suporte TI"
    WScript.Quit 1
End If

' Janela 0 = totalmente oculta. False = não aguarda o bot encerrar.
shell.Run """" & arquivoServico & """", 0, False
