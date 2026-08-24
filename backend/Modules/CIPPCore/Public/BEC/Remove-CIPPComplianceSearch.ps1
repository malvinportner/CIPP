function Remove-CIPPComplianceSearch {
    <#
    .SYNOPSIS
        Deletes a Purview content search definition.
    .DESCRIPTION
        Removes the search (and its actions) from Purview. Nothing in any mailbox is touched.
    .PARAMETER TenantFilter
        Tenant default domain name.
    .PARAMETER Name
        The search name.
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
        $Headers,
        [string]$APIName = 'BECContentSearch'
    )

    if (-not $PSCmdlet.ShouldProcess($Name, 'Remove-ComplianceSearch')) { return }
    try {
        $null = New-ExoRequest -tenantid $TenantFilter -Compliance -cmdlet 'Remove-ComplianceSearch' -cmdParams @{ Identity = $Name; Confirm = $false }
        $Message = "Removed content search '$Name'"
        Write-LogMessage -headers $Headers -API $APIName -tenant $TenantFilter -message $Message -Sev 'Info'
        return $Message
    } catch {
        $ErrorMessage = Get-CippException -Exception $_
        $Message = "Failed to remove content search '$Name': $($ErrorMessage.NormalizedError)"
        Write-LogMessage -headers $Headers -API $APIName -tenant $TenantFilter -message $Message -Sev 'Error' -LogData $ErrorMessage
        throw $Message
    }
}
