function New-CIPPBecRunRequest {
    <#
    .SYNOPSIS
        Prepares a BEC investigation: the history row, the live-progress job and the queue item.
    .DESCRIPTION
        Every way of starting a run (the user's page, the bulk action) goes through here so the run
        is visible the same way everywhere: a Waiting row in BecReports (the history), an
        async-deployment job keyed on the case id (the live progress the page polls; Queued until a
        worker picks it up) and the batch item to hand to Start-CIPPOrchestrator. Nothing is queued
        here; the caller queues one or many items. Every run is the full investigation.
    .PARAMETER TenantFilter
        Tenant default domain name.
    .PARAMETER UserId
        Object id of the user to investigate.
    .PARAMETER UserPrincipalName
        UPN of the user (used by the run and as the progress row name).
    .PARAMETER DisplayName
        Display name for the history row.
    .PARAMETER RequestedBy
        Who asked for the run.
    .PARAMETER QueueId
        Optional CIPP queue entry id (bulk runs).
    .FUNCTIONALITY
        Internal
    #>
    [CmdletBinding(SupportsShouldProcess = $true)]
    param(
        [Parameter(Mandatory = $true)][string]$TenantFilter,
        [Parameter(Mandatory = $true)][string]$UserId,
        [string]$UserPrincipalName,
        [string]$DisplayName,
        [string]$RequestedBy = 'CIPP',
        [string]$QueueId
    )

    $CaseId = New-CIPPBecCaseId
    $Name = if ([string]::IsNullOrWhiteSpace($UserPrincipalName)) { $UserId } else { $UserPrincipalName }
    if ($PSCmdlet.ShouldProcess("$Name in $TenantFilter", "Prepare BEC investigation $CaseId")) {
        $Properties = @{
            UserId            = $UserId
            UserPrincipalName = [string]$UserPrincipalName
            Status            = 'Waiting'
            Scope             = 'Full'
            RequestedBy       = $RequestedBy
            RequestedAt       = (Get-Date).ToUniversalTime().ToString('o')
        }
        if ($DisplayName) { $Properties.DisplayName = $DisplayName }
        if ($QueueId) { $Properties.QueueId = $QueueId }
        $null = Set-CIPPBecReport -TenantFilter $TenantFilter -CaseId $CaseId -Replace -Properties $Properties
        # The progress job: every step pending, row status queued, until Push-BECRun takes over.
        $null = New-CIPPAsyncDeployment -JobId $CaseId -Names @($Name) -StepTitles @((Get-CIPPBecRunSteps).Title) -Source 'BEC'
    }

    $Item = @{
        FunctionName = 'BECRun'
        UserID       = $UserId
        TenantFilter = $TenantFilter
        userName     = [string]$UserPrincipalName
        Scope        = 'Full'
        CaseId       = $CaseId
    }
    if ($QueueId) {
        $Item.QueueId = $QueueId
        $Item.QueueName = "BEC investigation $Name"
    }

    return [pscustomobject]@{
        CaseId = $CaseId
        Scope  = 'Full'
        Item   = $Item
    }
}
