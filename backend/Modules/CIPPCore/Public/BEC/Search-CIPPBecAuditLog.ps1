function Search-CIPPBecAuditLog {
    <#
    .SYNOPSIS
        Pages Search-UnifiedAuditLog for the BEC check with an explicit completeness marker.
    .DESCRIPTION
        Runs a ReturnLargeSet session with a stable session id and a fixed page size, follows the
        pages until the service reports the last row (ResultIndex = ResultCount), a short page comes
        back, or a page adds nothing new, and stops at MaxPages. Rows are de-duplicated on Identity and
        their AuditData JSON is parsed once. The caller gets { Records, Complete, Pages, Cap } so a
        capped search is reported as partial instead of silently truncated.

        Only metadata is read: the records are the audit log's own descriptions of what happened,
        never message content.
    .PARAMETER TenantFilter
        Tenant default domain name.
    .PARAMETER StartDate
        Window start (UTC).
    .PARAMETER EndDate
        Window end (UTC).
    .PARAMETER Operations
        Operations to search for.
    .PARAMETER UserIds
        Restrict to records attributed to these users. Always sent as an array - a bare string binds to
        the cmdlet's String[] as a scalar and EXO rejects it.
    .PARAMETER RecordType
        Optional record type filter (e.g. ExchangeAdmin).
    .PARAMETER ObjectIds
        Optional object id filter.
    .PARAMETER Anchor
        Anchor mailbox for the EXO request.
    .PARAMETER PageSize
        Rows per page (max 5000).
    .PARAMETER MaxPages
        Page cap; hitting it sets Complete to $false.
    .FUNCTIONALITY
        Internal
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$TenantFilter,
        [Parameter(Mandatory = $true)][datetime]$StartDate,
        [Parameter(Mandatory = $true)][datetime]$EndDate,
        [string[]]$Operations,
        [string[]]$UserIds,
        [string]$RecordType,
        [string[]]$ObjectIds,
        [string]$Anchor,
        [ValidateRange(1, 5000)][int]$PageSize = 5000,
        [ValidateRange(1, 200)][int]$MaxPages = 10
    )

    $SearchParam = @{
        SessionCommand = 'ReturnLargeSet'
        SessionId      = "CIPP-BEC-$([guid]::NewGuid().ToString('N'))"
        StartDate      = $StartDate
        EndDate        = $EndDate
        ResultSize     = $PageSize
    }
    if ($Operations) { $SearchParam.Operations = @($Operations) }
    if ($UserIds) { $SearchParam.UserIds = @($UserIds) }
    if ($RecordType) { $SearchParam.RecordType = $RecordType }
    if ($ObjectIds) { $SearchParam.ObjectIds = @($ObjectIds) }

    $ExoParams = @{ tenantid = $TenantFilter; cmdlet = 'Search-UnifiedAuditLog'; cmdParams = $SearchParam }
    if ($Anchor) { $ExoParams.Anchor = $Anchor }

    $Records = [System.Collections.Generic.List[object]]::new()
    $Seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $Pages = 0
    $Done = $false
    $Stalled = $false
    do {
        $Pages++
        # A search with no hits returns nothing at all rather than an empty page.
        $Batch = @(New-ExoRequest @ExoParams | Where-Object { $_ })
        $NewCount = 0
        foreach ($Item in $Batch) {
            $Key = if ($Item.Identity) { [string]$Item.Identity } else { "$($Item.CreationDate)|$($Item.Operations)|$($Item.UserIds)|$($Item.AuditData)" }
            if (-not $Seen.Add($Key)) { continue }
            $AuditData = try { $Item.AuditData | ConvertFrom-Json -ErrorAction Stop } catch { $null }
            $Records.Add([pscustomobject]@{
                    Identity     = $Item.Identity
                    CreationDate = $Item.CreationDate
                    Operation    = $Item.Operations ?? $AuditData.Operation
                    UserId       = $Item.UserIds ?? $AuditData.UserId
                    RecordType   = $Item.RecordType
                    AuditData    = $AuditData
                })
            $NewCount++
        }
        $Last = if ($Batch.Count -gt 0) { $Batch[-1] } else { $null }
        $ServiceSaysDone = $Last -and $Last.ResultCount -and $Last.ResultIndex -and ([int]$Last.ResultIndex -ge [int]$Last.ResultCount)
        $Done = ($Batch.Count -eq 0) -or ($Batch.Count -lt $PageSize) -or $ServiceSaysDone
        # A full page that adds nothing new means the session is replaying: stop, but do not call it complete.
        if (-not $Done -and $NewCount -eq 0) { $Stalled = $true; break }
    } while (-not $Done -and $Pages -lt $MaxPages)

    return [pscustomobject]@{
        Records  = $Records.ToArray()
        Complete = [bool]$Done
        Pages    = $Pages
        Cap      = if ($Done) { $null } elseif ($Stalled) { 'paging stalled (duplicate page returned)' } else { "$MaxPages pages of $PageSize records" }
    }
}
