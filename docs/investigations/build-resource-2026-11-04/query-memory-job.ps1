$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MemoryProbe {
 [StructLayout(LayoutKind.Sequential)] public struct Basic { public long PerProcessUserTimeLimit,PerJobUserTimeLimit;public uint LimitFlags;public UIntPtr MinWS,MaxWS;public uint ActiveProcessLimit;public UIntPtr Affinity;public uint PriorityClass,SchedulingClass; }
 [StructLayout(LayoutKind.Sequential)] public struct Io {public ulong a,b,c,d,e,f;}
 [StructLayout(LayoutKind.Sequential)] public struct Extended {public Basic BasicLimitInformation;public Io IoInfo;public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed;}
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool QueryInformationJobObject(IntPtr job,int cls,out Extended data,int len,IntPtr ret);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
 public static Extended Query(){Extended e;QueryInformationJobObject(IntPtr.Zero,9,out e,Marshal.SizeOf(typeof(Extended)),IntPtr.Zero);return e;}
}
'@
$inJob=$false
[void][MemoryProbe]::IsProcessInJob([intptr](-1),[intptr]::Zero,[ref]$inJob)
$info=[MemoryProbe]::Query()
[pscustomobject]@{inJob=$inJob;error=[Runtime.InteropServices.Marshal]::GetLastWin32Error();flags=$info.BasicLimitInformation.LimitFlags;processLimit=$info.ProcessMemoryLimit.ToUInt64();jobLimit=$info.JobMemoryLimit.ToUInt64();peakProcess=$info.PeakProcessMemoryUsed.ToUInt64();peakJob=$info.PeakJobMemoryUsed.ToUInt64()} | ConvertTo-Json -Compress
