BeforeAll {
    $RepoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
    class HttpResponseContext { [int]$StatusCode; [object]$Body }
    $TypeAccelerators = [PowerShell].Assembly.GetType('System.Management.Automation.TypeAccelerators')
    if (-not ([System.Management.Automation.PSTypeName]'HttpStatusCode').Type) {
        $TypeAccelerators::Add('HttpStatusCode', [System.Net.HttpStatusCode])
    }
    function New-CIPPComplianceSearch { param($TenantFilter, $Name, $CaseId, $Sender, $Subject, $StartDate, $EndDate, $Locations, $Headers, $APIName) }
    function Get-CIPPComplianceSearch { param($TenantFilter, $Name) }
    function Invoke-CIPPComplianceSearchPurge { param($TenantFilter, $Name, [switch]$Confirmed, $Headers, $APIName) }
    function Remove-CIPPComplianceSearch { param($TenantFilter, $Name, $Headers, $APIName) }
    function Test-CIPPBecSuperAdmin { param($Headers) }
    function Set-CippBecCaseContext { param($CaseId) }
    function Write-LogMessage { param($message, $tenant, $API, $tenantId, $headers, $user, $sev, $LogData) }
    function Get-CippException { param($Exception) [pscustomobject]@{ NormalizedError = [string]$Exception.Exception.Message } }
    $FunctionPath = Get-ChildItem -Path (Join-Path $RepoRoot 'Modules') -Recurse -Filter 'Invoke-ExecBECContentSearch.ps1' | Select-Object -First 1
    . $FunctionPath.FullName

    function New-Request {
        param([hashtable]$Body)
        [pscustomobject]@{
            Params  = [pscustomobject]@{ CIPPEndpoint = 'ExecBECContentSearch' }
            Headers = [pscustomobject]@{ 'x-ms-client-principal' = 'x' }
            Query   = $null
            Body    = [pscustomobject]$Body
        }
    }
    $script:SearchStatus = [pscustomobject]@{ Name = 'CIPP-BEC-1'; Status = 'Completed'; Items = 12; Size = 4096; LocationsWithHits = 3; Locations = @() }
}

Describe 'Invoke-ExecBECContentSearch' {
    BeforeEach {
        Mock Write-LogMessage { }
        Mock Set-CippBecCaseContext { }
        Mock Get-CIPPComplianceSearch { $script:SearchStatus }
        Mock Invoke-CIPPComplianceSearchPurge { [pscustomobject]@{ Name = $Name; Found = 12; Message = 'Purge started' } }
        Mock New-CIPPComplianceSearch { [pscustomobject]@{ Name = 'CIPP-BEC-1'; Query = 'from:"x"'; Locations = @('All'); Message = 'created' } }
        Mock Remove-CIPPComplianceSearch { 'removed' }
        Mock Test-CIPPBecSuperAdmin { $true }
    }

    It 'creates a search from sender/subject/date and starts it' {
        $Response = Invoke-ExecBECContentSearch -Request (New-Request @{ tenantFilter = 'contoso.com'; Action = 'Create'; caseId = 'BEC-1'; Sender = 'bad@example.org'; Subject = 'Invoice'; StartDate = '2026-08-10'; EndDate = '2026-08-20'; Locations = @([pscustomobject]@{ value = 'victim@contoso.com'; label = 'victim' }) }) -TriggerMetadata $null
        $Response.StatusCode | Should -Be 200
        $Response.Body.Search.Name | Should -Be 'CIPP-BEC-1'
        Should -Invoke New-CIPPComplianceSearch -Times 1 -ParameterFilter { $Sender -eq 'bad@example.org' -and $Subject -eq 'Invoice' -and $Locations -contains 'victim@contoso.com' -and $CaseId -eq 'BEC-1' -and $StartDate -is [datetime] }
        Should -Invoke Set-CippBecCaseContext -Times 1 -ParameterFilter { $CaseId -eq 'BEC-1' }
    }

    It 'returns status counts only' {
        $Response = Invoke-ExecBECContentSearch -Request (New-Request @{ tenantFilter = 'contoso.com'; Action = 'Status'; Name = 'CIPP-BEC-1' }) -TriggerMetadata $null
        $Response.StatusCode | Should -Be 200
        $Response.Body.Results.Items | Should -Be 12
    }

    Context 'Purge' {
        It 'is refused with 403 for anyone who is not a superadmin, before anything is read' {
            Mock Test-CIPPBecSuperAdmin { $false }
            $Response = Invoke-ExecBECContentSearch -Request (New-Request @{ tenantFilter = 'contoso.com'; Action = 'Purge'; Name = 'CIPP-BEC-1'; Confirmation = 'CIPP-BEC-1' }) -TriggerMetadata $null
            $Response.StatusCode | Should -Be 403
            $Response.Body.Results.state | Should -Be 'error'
            Should -Invoke Invoke-CIPPComplianceSearchPurge -Times 0
            Should -Invoke Get-CIPPComplianceSearch -Times 0
        }

        It 'returns 400 without the typed search name' {
            $Response = Invoke-ExecBECContentSearch -Request (New-Request @{ tenantFilter = 'contoso.com'; Action = 'Purge'; Name = 'CIPP-BEC-1'; Confirmation = 'cipp-bec-1' }) -TriggerMetadata $null
            $Response.StatusCode | Should -Be 400
            $Response.Body.Results.resultText | Should -Match 'Type the search name'
            Should -Invoke Invoke-CIPPComplianceSearchPurge -Times 0
        }

        It 'purges only for a superadmin who typed the exact search name' {
            $Response = Invoke-ExecBECContentSearch -Request (New-Request @{ tenantFilter = 'contoso.com'; Action = 'Purge'; Name = 'CIPP-BEC-1'; Confirmation = 'CIPP-BEC-1'; caseId = 'BEC-1' }) -TriggerMetadata $null
            $Response.StatusCode | Should -Be 200
            $Response.Body.Results.state | Should -Be 'success'
            Should -Invoke Invoke-CIPPComplianceSearchPurge -Times 1 -ParameterFilter { $Name -eq 'CIPP-BEC-1' -and $Confirmed.IsPresent }
        }
    }

    It 'removes a search' {
        $Response = Invoke-ExecBECContentSearch -Request (New-Request @{ tenantFilter = 'contoso.com'; Action = 'Remove'; Name = 'CIPP-BEC-1' }) -TriggerMetadata $null
        $Response.Body.Results | Should -Be 'removed'
    }

    It 'rejects an unknown action and clears the case context' {
        $Response = Invoke-ExecBECContentSearch -Request (New-Request @{ tenantFilter = 'contoso.com'; Action = 'Explode'; Name = 'x' }) -TriggerMetadata $null
        $Response.StatusCode | Should -Be 500
        Should -Invoke Set-CippBecCaseContext -Times 1 -ParameterFilter { [string]::IsNullOrEmpty($CaseId) }
    }
}
