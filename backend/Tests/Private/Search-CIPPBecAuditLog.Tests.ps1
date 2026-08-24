BeforeAll {
    $RepoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
    function New-ExoRequest { param($tenantid, $cmdlet, $cmdParams, $Anchor) }
    . (Join-Path $RepoRoot 'Modules/CIPPCore/Public/BEC/Search-CIPPBecAuditLog.ps1')

    function New-Page {
        param([int]$From, [int]$Count, [int]$Total, [string]$Prefix = 'id')
        foreach ($i in $From..($From + $Count - 1)) {
            [pscustomobject]@{
                Identity     = "$Prefix$i"
                CreationDate = '2026-08-20T10:00:00Z'
                Operations   = 'New-InboxRule'
                UserIds      = 'user@contoso.com'
                RecordType   = 'ExchangeAdmin'
                ResultIndex  = $i
                ResultCount  = $Total
                AuditData    = "{`"Operation`":`"New-InboxRule`",`"Id`":$i}"
            }
        }
    }
    $script:Start = (Get-Date).AddDays(-7)
    $script:End = Get-Date
}

Describe 'Search-CIPPBecAuditLog' {
    BeforeEach {
        $script:Calls = [System.Collections.Generic.List[object]]::new()
    }

    It 'returns a short page as complete with parsed AuditData' {
        Mock New-ExoRequest { $script:Calls.Add($cmdParams); New-Page -From 1 -Count 3 -Total 3 }
        $Result = Search-CIPPBecAuditLog -TenantFilter 'contoso.com' -StartDate $script:Start -EndDate $script:End -Operations @('New-InboxRule') -UserIds @('user@contoso.com') -PageSize 5000
        $Result.Complete | Should -BeTrue
        $Result.Pages | Should -Be 1
        $Result.Cap | Should -BeNullOrEmpty
        $Result.Records.Count | Should -Be 3
        $Result.Records[0].AuditData.Id | Should -Be 1
        $Result.Records[0].Operation | Should -Be 'New-InboxRule'
    }

    It 'sends ReturnLargeSet, ResultSize and an array UserIds with a stable session id' {
        Mock New-ExoRequest { $script:Calls.Add($cmdParams); New-Page -From 1 -Count 1 -Total 1 }
        $null = Search-CIPPBecAuditLog -TenantFilter 'contoso.com' -StartDate $script:Start -EndDate $script:End -Operations @('A') -UserIds 'user@contoso.com' -PageSize 100
        $script:Calls[0].SessionCommand | Should -Be 'ReturnLargeSet'
        $script:Calls[0].ResultSize | Should -Be 100
        $script:Calls[0].UserIds -is [array] | Should -BeTrue
        $script:Calls[0].SessionId | Should -Match '^CIPP-BEC-'
    }

    It 'follows full pages until the service reports the last row and reuses the session id' {
        Mock New-ExoRequest {
            $script:Calls.Add($cmdParams)
            switch ($script:Calls.Count) {
                1 { New-Page -From 1 -Count 4 -Total 10 }
                2 { New-Page -From 5 -Count 4 -Total 10 }
                default { New-Page -From 9 -Count 2 -Total 10 }
            }
        }
        $Result = Search-CIPPBecAuditLog -TenantFilter 'contoso.com' -StartDate $script:Start -EndDate $script:End -PageSize 4 -MaxPages 10
        $Result.Complete | Should -BeTrue
        $Result.Pages | Should -Be 3
        $Result.Records.Count | Should -Be 10
        ($script:Calls | ForEach-Object { $_.SessionId } | Select-Object -Unique).Count | Should -Be 1
    }

    It 'stops at an exact multiple of the page size when ResultIndex reaches ResultCount' {
        Mock New-ExoRequest { $script:Calls.Add($cmdParams); New-Page -From 1 -Count 4 -Total 4 }
        $Result = Search-CIPPBecAuditLog -TenantFilter 'contoso.com' -StartDate $script:Start -EndDate $script:End -PageSize 4 -MaxPages 10
        $Result.Complete | Should -BeTrue
        $Result.Pages | Should -Be 1
        $Result.Records.Count | Should -Be 4
    }

    It 'reports partial results when the page cap is hit' {
        Mock New-ExoRequest { $script:Calls.Add($cmdParams); New-Page -From (($script:Calls.Count - 1) * 4 + 1) -Count 4 -Total 100 }
        $Result = Search-CIPPBecAuditLog -TenantFilter 'contoso.com' -StartDate $script:Start -EndDate $script:End -PageSize 4 -MaxPages 2
        $Result.Complete | Should -BeFalse
        $Result.Pages | Should -Be 2
        $Result.Cap | Should -Match '2 pages'
        $Result.Records.Count | Should -Be 8
    }

    It 'stops and reports partial results when the service replays the same page' {
        Mock New-ExoRequest { $script:Calls.Add($cmdParams); New-Page -From 1 -Count 4 -Total 100 }
        $Result = Search-CIPPBecAuditLog -TenantFilter 'contoso.com' -StartDate $script:Start -EndDate $script:End -PageSize 4 -MaxPages 10
        $Result.Complete | Should -BeFalse
        $Result.Cap | Should -Match 'stalled'
        $Result.Records.Count | Should -Be 4
        $Result.Pages | Should -Be 2
    }

    It 'returns an empty, complete result when the search has no hits' {
        Mock New-ExoRequest { $script:Calls.Add($cmdParams); $null }
        $Result = Search-CIPPBecAuditLog -TenantFilter 'contoso.com' -StartDate $script:Start -EndDate $script:End -Operations @('X')
        $Result.Complete | Should -BeTrue
        $Result.Records.Count | Should -Be 0
    }

    It 'keeps a record whose AuditData is not JSON instead of failing the search' {
        Mock New-ExoRequest { $script:Calls.Add($cmdParams); [pscustomobject]@{ Identity = 'x'; Operations = 'Op'; AuditData = 'not json'; ResultIndex = 1; ResultCount = 1 } }
        $Result = Search-CIPPBecAuditLog -TenantFilter 'contoso.com' -StartDate $script:Start -EndDate $script:End
        $Result.Records.Count | Should -Be 1
        $Result.Records[0].AuditData | Should -BeNullOrEmpty
        $Result.Records[0].Operation | Should -Be 'Op'
    }
}
