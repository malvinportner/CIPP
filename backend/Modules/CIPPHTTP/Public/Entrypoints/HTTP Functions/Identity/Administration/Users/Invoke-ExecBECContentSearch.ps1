function Invoke-ExecBECContentSearch {
    <#
    .FUNCTIONALITY
        Entrypoint
    .ROLE
        Identity.User.ReadWrite
    .SYNOPSIS
        Creates, polls, purges or removes a Purview content search for a BEC case.
    .DESCRIPTION
        Action=Create builds a KQL query from Sender, Subject, StartDate and EndDate, creates the search across Locations ('All' or mailbox addresses) and starts it. Action=Status returns its state and item counts per location - counts only, never content. Action=Purge soft-deletes the found items through Purview: it needs the superadmin role and Confirmation equal to the search name; Purview removes at most 10 items per mailbox per run. Action=Remove deletes the search definition. CIPP-SAM needs the Purview Compliance Search role (and Search And Purge for Purge).
    #>
    [CmdletBinding()]
    param($Request, $TriggerMetadata)

    $APIName = $Request.Params.CIPPEndpoint
    $Headers = $Request.Headers
    $TenantFilter = $Request.Body.tenantFilter
    # Create | Status | Purge | Remove
    $Action = [string]$Request.Body.Action
    # the search name (required for Status/Purge/Remove; generated on Create)
    $Name = [string]$Request.Body.Name
    $CaseId = [string]$Request.Body.caseId
    # on Purge: must equal the search name
    $Confirmation = [string]$Request.Body.Confirmation

    Set-CippBecCaseContext -CaseId $CaseId
    try {
        if (-not $TenantFilter) { throw 'tenantFilter is required' }
        $StatusCode = [HttpStatusCode]::OK
        switch ($Action) {
            'Create' {
                $Params = @{ TenantFilter = $TenantFilter; CaseId = $CaseId; Headers = $Headers; APIName = $APIName }
                if ($Request.Body.Sender) { $Params.Sender = [string]$Request.Body.Sender }
                if ($Request.Body.Subject) { $Params.Subject = [string]$Request.Body.Subject }
                if ($Request.Body.StartDate) { $Params.StartDate = [datetime]$Request.Body.StartDate }
                if ($Request.Body.EndDate) { $Params.EndDate = [datetime]$Request.Body.EndDate }
                $Locations = @($Request.Body.Locations | ForEach-Object { if ($_ -and $_.PSObject.Properties['value']) { $_.value } else { $_ } } | Where-Object { $_ })
                if ($Locations.Count -gt 0) { $Params.Locations = $Locations }
                $Search = New-CIPPComplianceSearch @Params
                $Body = @{ Results = $Search.Message; Search = $Search }
            }
            'Status' {
                if (-not $Name) { throw 'Name is required' }
                $Body = @{ Results = (Get-CIPPComplianceSearch -TenantFilter $TenantFilter -Name $Name) }
            }
            'Purge' {
                if (-not $Name) { throw 'Name is required' }
                if (-not (Test-CIPPBecSuperAdmin -Headers $Headers)) {
                    $StatusCode = [HttpStatusCode]::Forbidden
                    throw 'Purging mail through Purview is irreversible and requires the superadmin role'
                }
                # exact, case-sensitive: the operator types the search name as shown
                if (-not $Confirmation -or $Confirmation.Trim() -cne $Name) {
                    $StatusCode = [HttpStatusCode]::BadRequest
                    throw "Type the search name ($Name) to confirm the purge"
                }
                $Purge = Invoke-CIPPComplianceSearchPurge -TenantFilter $TenantFilter -Name $Name -Confirmed -Headers $Headers -APIName $APIName
                $Body = @{ Results = [pscustomobject]@{ resultText = $Purge.Message; state = 'success' }; Purge = $Purge }
            }
            'Remove' {
                if (-not $Name) { throw 'Name is required' }
                $Body = @{ Results = (Remove-CIPPComplianceSearch -TenantFilter $TenantFilter -Name $Name -Headers $Headers -APIName $APIName) }
            }
            default { throw "Unknown action '$Action' (Create, Status, Purge, Remove)" }
        }
    } catch {
        $ErrorMessage = Get-CippException -Exception $_
        if (-not $StatusCode -or $StatusCode -eq [HttpStatusCode]::OK) { $StatusCode = [HttpStatusCode]::InternalServerError }
        $Body = @{ Results = [pscustomobject]@{ resultText = $ErrorMessage.NormalizedError; state = 'error' } }
    } finally {
        Set-CippBecCaseContext -CaseId $null
    }

    return ([HttpResponseContext]@{
            StatusCode = $StatusCode
            Body       = $Body
        })
}
