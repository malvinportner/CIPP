function Get-CIPPComplianceSearch {
    <#
    .SYNOPSIS
        Reads a Purview content search's status and item counts.
    .DESCRIPTION
        Returns the search status, total item count and size, the per-location counts parsed from the
        SuccessResults text, and the status of its purge action when one exists. Counts and locations
        only - nothing about the items themselves comes back.
    .PARAMETER TenantFilter
        Tenant default domain name.
    .PARAMETER Name
        The search name.
    .FUNCTIONALITY
        Internal
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$TenantFilter,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $Search = New-ExoRequest -tenantid $TenantFilter -Compliance -cmdlet 'Get-ComplianceSearch' -cmdParams @{ Identity = $Name }
    if (-not $Search) { throw "Content search '$Name' was not found" }

    # SuccessResults is one text line per location: "Location: x, Item count: N, Total size: M"
    $Locations = @()
    $SuccessText = [string]$Search.SuccessResults
    if ($SuccessText) {
        $Locations = @([regex]::Matches($SuccessText, '(?i)Location:\s*(?<Location>[^,]+),\s*Item count:\s*(?<Count>\d+),\s*Total size:\s*(?<Size>\d+)') | ForEach-Object {
                [pscustomobject]@{ Location = $_.Groups['Location'].Value.Trim(); ItemCount = [int]$_.Groups['Count'].Value; TotalSize = [long]$_.Groups['Size'].Value }
            } | Where-Object { $_.ItemCount -gt 0 } | Sort-Object -Property ItemCount -Descending)
    }

    $Purge = $null
    try {
        $Action = New-ExoRequest -tenantid $TenantFilter -Compliance -cmdlet 'Get-ComplianceSearchAction' -cmdParams @{ Identity = "$($Name)_Purge" }
        if ($Action) {
            $Results = [string]$Action.Results
            $PurgedMatches = [regex]::Matches($Results, '(?i)Item count:\s*(?<Count>\d+)')
            $Purge = [pscustomobject]@{
                Status      = $Action.Status
                Action      = $Action.Action
                CreatedTime = $Action.CreatedTime
                Results     = $Results
                ItemsPurged = ($PurgedMatches | ForEach-Object { [int]$_.Groups['Count'].Value } | Measure-Object -Sum).Sum
            }
        }
    } catch {
        $Purge = $null
    }

    return [pscustomobject]@{
        Name              = $Search.Name
        Status            = $Search.Status
        Items             = $Search.Items
        Size              = $Search.Size
        ContentMatchQuery = $Search.ContentMatchQuery
        ExchangeLocation  = @($Search.ExchangeLocation)
        Locations         = $Locations
        LocationsWithHits = $Locations.Count
        Errors            = $Search.Errors
        CreatedBy         = $Search.CreatedBy
        JobStartTime      = $Search.JobStartTime
        JobEndTime        = $Search.JobEndTime
        Purge             = $Purge
    }
}
