BeforeAll {
    $RepoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
    function New-ExoRequest { param($tenantid, $cmdlet, $cmdParams, $Anchor, $Select, $useSystemMailbox, $NoAuthCheck, [switch]$Compliance, $ApiVersion, [switch]$AsApp) }
    function Write-LogMessage { param($message, $tenant, $API, $tenantId, $headers, $user, $sev, $LogData) }
    function Get-CippException { param($Exception) [pscustomobject]@{ NormalizedError = [string]$Exception.Exception.Message } }
    . (Join-Path $RepoRoot 'Modules/CIPPCore/Public/BEC/New-CIPPComplianceSearch.ps1')
    . (Join-Path $RepoRoot 'Modules/CIPPCore/Public/BEC/Get-CIPPComplianceSearch.ps1')
    . (Join-Path $RepoRoot 'Modules/CIPPCore/Public/BEC/Invoke-CIPPComplianceSearchPurge.ps1')
}

Describe 'New-CIPPComplianceSearch' {
    BeforeEach {
        $script:Calls = [System.Collections.Generic.List[object]]::new()
        Mock New-ExoRequest { $script:Calls.Add(@{ Cmdlet = $cmdlet; Params = $cmdParams; Compliance = $Compliance.IsPresent }); $null }
        Mock Write-LogMessage { }
    }

    It 'builds a quoted KQL query, creates the search through the compliance endpoint and starts it' {
        $Result = New-CIPPComplianceSearch -TenantFilter 'contoso.com' -CaseId 'BEC-20260820120000-abc123' -Sender 'bad@example.org' -Subject 'Invoice "urgent"' -StartDate (Get-Date '2026-08-10') -EndDate (Get-Date '2026-08-20') -Locations @('victim@contoso.com', 'cfo@contoso.com')
        $script:Calls.Count | Should -Be 2
        $script:Calls[0].Cmdlet | Should -Be 'New-ComplianceSearch'
        $script:Calls[0].Compliance | Should -BeTrue
        $script:Calls[0].Params.ContentMatchQuery | Should -Be 'from:"bad@example.org" AND subject:"Invoice urgent" AND (sent>=2026-08-10 AND sent<=2026-08-20)'
        $script:Calls[0].Params.ExchangeLocation | Should -Be @('victim@contoso.com', 'cfo@contoso.com')
        $script:Calls[0].Params.Name | Should -Match '^CIPP-BEC-BEC-20260820120000-abc123-\d{14}$'
        $script:Calls[1].Cmdlet | Should -Be 'Start-ComplianceSearch'
        $script:Calls[1].Compliance | Should -BeTrue
        $Result.Query | Should -Match '^from:'
    }

    It 'defaults to every mailbox and refuses an empty query' {
        $null = New-CIPPComplianceSearch -TenantFilter 'contoso.com' -Sender 'bad@example.org'
        $script:Calls[0].Params.ExchangeLocation | Should -Be @('All')
        { New-CIPPComplianceSearch -TenantFilter 'contoso.com' } | Should -Throw '*at least a sender*'
    }

    It 'explains the missing Purview role when the cmdlet is not available to CIPP-SAM' {
        Mock New-ExoRequest { throw "The term 'New-ComplianceSearch' is not recognized" }
        { New-CIPPComplianceSearch -TenantFilter 'contoso.com' -Sender 'bad@example.org' } | Should -Throw '*eDiscovery Manager*'
    }
}

Describe 'Get-CIPPComplianceSearch' {
    It 'parses the per-location counts out of SuccessResults and the purge action status' {
        Mock New-ExoRequest {
            if ($cmdlet -eq 'Get-ComplianceSearch') {
                [pscustomobject]@{ Name = 'CIPP-BEC-1'; Status = 'Completed'; Items = 7; Size = 99000; ContentMatchQuery = 'from:"x"'; ExchangeLocation = @('All'); SuccessResults = "Location: victim@contoso.com, Item count: 5, Total size: 60000`r`nLocation: cfo@contoso.com, Item count: 2, Total size: 39000`r`nLocation: clean@contoso.com, Item count: 0, Total size: 0"; Errors = $null; CreatedBy = 'CIPP' }
            } else {
                [pscustomobject]@{ Status = 'Completed'; Action = 'Purge'; CreatedTime = '2026-08-20T12:00:00Z'; Results = 'Purge Type: SoftDelete; Item count: 5, Total size: 60000; Item count: 2, Total size: 39000' }
            }
        }
        $Result = Get-CIPPComplianceSearch -TenantFilter 'contoso.com' -Name 'CIPP-BEC-1'
        $Result.Items | Should -Be 7
        $Result.LocationsWithHits | Should -Be 2
        $Result.Locations[0].Location | Should -Be 'victim@contoso.com'
        $Result.Locations[0].ItemCount | Should -Be 5
        $Result.Locations.Location | Should -Not -Contain 'clean@contoso.com'
        $Result.Purge.Status | Should -Be 'Completed'
        $Result.Purge.ItemsPurged | Should -Be 7
        # counts only: nothing resembling a subject or body is projected
        $Result.PSObject.Properties.Name | Should -Not -Contain 'Items_Detail'
    }

    It 'tolerates a search without a purge action and throws for an unknown search' {
        Mock New-ExoRequest { if ($cmdlet -eq 'Get-ComplianceSearch') { [pscustomobject]@{ Name = 'x'; Status = 'InProgress'; Items = 0; Size = 0 } } else { throw 'not found' } }
        $Result = Get-CIPPComplianceSearch -TenantFilter 'contoso.com' -Name 'x'
        $Result.Purge | Should -BeNullOrEmpty
        $Result.Locations.Count | Should -Be 0
        Mock New-ExoRequest { $null }
        { Get-CIPPComplianceSearch -TenantFilter 'contoso.com' -Name 'missing' } | Should -Throw '*not found*'
    }
}

Describe 'Invoke-CIPPComplianceSearchPurge' {
    BeforeEach {
        Mock Write-LogMessage { }
        $script:Calls = [System.Collections.Generic.List[object]]::new()
        Mock New-ExoRequest {
            $script:Calls.Add(@{ Cmdlet = $cmdlet; Params = $cmdParams })
            switch ($cmdlet) {
                'Get-ComplianceSearch' { [pscustomobject]@{ Name = 'CIPP-BEC-1'; Status = $script:SearchState; Items = $script:SearchItems; Size = 1; SuccessResults = 'Location: victim@contoso.com, Item count: 12, Total size: 1' } }
                'Get-ComplianceSearchAction' { throw 'not found' }
                default { $null }
            }
        }
        $script:SearchState = 'Completed'
        $script:SearchItems = 12
    }

    It 'refuses without confirmation and never touches Purview' {
        { Invoke-CIPPComplianceSearchPurge -TenantFilter 'contoso.com' -Name 'CIPP-BEC-1' } | Should -Throw '*not confirmed*'
        $script:Calls.Count | Should -Be 0
    }

    It 'refuses a search that has not completed' {
        $script:SearchState = 'InProgress'
        { Invoke-CIPPComplianceSearchPurge -TenantFilter 'contoso.com' -Name 'CIPP-BEC-1' -Confirmed } | Should -Throw '*must be Completed*'
        @($script:Calls | Where-Object { $_.Cmdlet -eq 'New-ComplianceSearchAction' }).Count | Should -Be 0
    }

    It 'does nothing for a search with no hits' {
        $script:SearchItems = 0
        $Result = Invoke-CIPPComplianceSearchPurge -TenantFilter 'contoso.com' -Name 'CIPP-BEC-1' -Confirmed
        $Result.Purged | Should -Be 0
        @($script:Calls | Where-Object { $_.Cmdlet -eq 'New-ComplianceSearchAction' }).Count | Should -Be 0
    }

    It 'soft-deletes through New-ComplianceSearchAction and reports the 10-per-mailbox cap' {
        $Result = Invoke-CIPPComplianceSearchPurge -TenantFilter 'contoso.com' -Name 'CIPP-BEC-1' -Confirmed
        $Purge = $script:Calls | Where-Object { $_.Cmdlet -eq 'New-ComplianceSearchAction' }
        $Purge.Params.SearchName | Should -Be 'CIPP-BEC-1'
        $Purge.Params.Purge | Should -BeTrue
        $Purge.Params.PurgeType | Should -Be 'SoftDelete'
        $Purge.Params.Confirm | Should -BeFalse
        $Result.Found | Should -Be 12
        $Result.ExpectedThisRun | Should -Be 10
        $Result.Message | Should -Match 'at most 10 per mailbox'
    }
}
