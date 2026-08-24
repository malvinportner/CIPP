function Invoke-CIPPComplianceSearchPurge {
    <#
    .SYNOPSIS
        Soft-deletes the items a completed Purview content search found.
    .DESCRIPTION
        Runs New-ComplianceSearchAction -Purge -PurgeType SoftDelete for the search. This is the
        GDAP-compatible way to remove a phishing message from every mailbox it reached: Purview acts on
        the content and CIPP only ever sees counts. Purview purges at most 10 items per mailbox per
        action, so the result reports purged-of-found and the caller re-runs until the search count
        drops to zero. Refuses to run without -Confirmed; the endpoint only sets it after a SuperAdmin
        has seen a dry run and typed the search name.
    .PARAMETER TenantFilter
        Tenant default domain name.
    .PARAMETER Name
        The search name.
    .PARAMETER Confirmed
        Set only after the operator confirmed the purge.
    .PARAMETER Headers
        CIPP request headers for logging.
    .PARAMETER APIName
        Logging API name.
    .FUNCTIONALITY
        Internal
    #>
    [CmdletBinding(SupportsShouldProcess = $true)]
    param(
        [Parameter(Mandatory = $true)][string]$TenantFilter,
        [Parameter(Mandatory = $true)][string]$Name,
        [switch]$Confirmed,
        $Headers,
        [string]$APIName = 'BECContentSearch'
    )

    if (-not $Confirmed) {
        throw "Purge of content search '$Name' refused: the purge was not confirmed"
    }
    $Search = Get-CIPPComplianceSearch -TenantFilter $TenantFilter -Name $Name
    if ($Search.Status -ne 'Completed') {
        throw "Content search '$Name' is $($Search.Status); it must be Completed before it can be purged"
    }
    if ([int]$Search.Items -le 0) {
        $Message = "Content search '$Name' found no items; nothing to purge"
        Write-LogMessage -headers $Headers -API $APIName -tenant $TenantFilter -message $Message -Sev 'Info'
        return [pscustomobject]@{ Name = $Name; Found = 0; Purged = 0; Message = $Message }
    }
    if (-not $PSCmdlet.ShouldProcess($Name, "Purge (SoftDelete) $($Search.Items) item(s) across $($Search.LocationsWithHits) location(s)")) { return }
    try {
        $null = New-ExoRequest -tenantid $TenantFilter -Compliance -cmdlet 'New-ComplianceSearchAction' -cmdParams @{ SearchName = $Name; Purge = $true; PurgeType = 'SoftDelete'; Confirm = $false }
        # A purge batch is capped at 10 items per mailbox; the action's Results report what was removed.
        $Expected = [Math]::Min([int]$Search.Items, 10 * [Math]::Max(1, $Search.LocationsWithHits))
        $Message = "Purge (SoftDelete) started for content search '$Name': $($Search.Items) item(s) found across $($Search.LocationsWithHits) mailbox(es); Purview removes at most 10 per mailbox per run, re-run the search and purge until the count reaches zero"
        Write-LogMessage -headers $Headers -API $APIName -tenant $TenantFilter -message $Message -Sev 'Info'
        return [pscustomobject]@{ Name = $Name; Found = [int]$Search.Items; Locations = $Search.LocationsWithHits; ExpectedThisRun = $Expected; Message = $Message }
    } catch {
        $ErrorMessage = Get-CippException -Exception $_
        $Detail = $ErrorMessage.NormalizedError
        if ($Detail -match '(?i)not recognized|access ?denied|unauthori[sz]ed|insufficient|forbidden|role|permission') {
            $Detail = "$Detail. Purging needs the Purview 'Search And Purge' role on the CIPP-SAM service principal, which the Compliance Search role does not include."
        }
        $Message = "Failed to purge content search '$Name': $Detail"
        Write-LogMessage -headers $Headers -API $APIName -tenant $TenantFilter -message $Message -Sev 'Error' -LogData $ErrorMessage
        throw $Message
    }
}
