function New-CIPPComplianceSearch {
    <#
    .SYNOPSIS
        Creates and starts a Purview content search from sender/subject/date criteria.
    .DESCRIPTION
        Builds a KQL query from the supplied metadata (sender address, subject fragment, date range),
        creates the search against the given mailboxes (or every mailbox) through the Security &
        Compliance endpoint, and starts it. The search is how a phishing message is located across
        mailboxes without anyone reading mail: only item counts per location come back. CIPP-SAM needs
        a Purview role that includes Compliance Search (eDiscovery Manager); without it the error says
        so explicitly.
    .PARAMETER TenantFilter
        Tenant default domain name.
    .PARAMETER Name
        Search name. Generated as CIPP-BEC-<caseId>-<stamp> when omitted.
    .PARAMETER CaseId
        The BEC case id (for the name and description).
    .PARAMETER Sender
        Sender address to match (from:).
    .PARAMETER Subject
        Subject fragment to match (subject:).
    .PARAMETER StartDate
        Earliest sent date.
    .PARAMETER EndDate
        Latest sent date.
    .PARAMETER Locations
        'All' or one or more mailbox addresses.
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
        [string]$Name,
        [string]$CaseId,
        [Alias('Sender')][string]$SenderAddress,
        [string]$Subject,
        [datetime]$StartDate,
        [datetime]$EndDate,
        [string[]]$Locations = @('All'),
        $Headers,
        [string]$APIName = 'BECContentSearch'
    )

    if ([string]::IsNullOrWhiteSpace($SenderAddress) -and [string]::IsNullOrWhiteSpace($Subject)) {
        throw 'A content search needs at least a sender address or a subject fragment'
    }
    # KQL phrases are double-quoted; strip quotes from the inputs so they cannot break out of the phrase.
    $Clean = { param($Value) ([string]$Value -replace '["\r\n]', '').Trim() }
    $Parts = [System.Collections.Generic.List[string]]::new()
    if ($SenderAddress) { $Parts.Add("from:`"$(& $Clean $SenderAddress)`"") }
    if ($Subject) { $Parts.Add("subject:`"$(& $Clean $Subject)`"") }
    # KQL dates are calendar days; use the dates as supplied rather than shifting them to UTC
    if ($StartDate -and $EndDate) {
        $Parts.Add("(sent>=$($StartDate.ToString('yyyy-MM-dd')) AND sent<=$($EndDate.ToString('yyyy-MM-dd')))")
    } elseif ($StartDate) {
        $Parts.Add("sent>=$($StartDate.ToString('yyyy-MM-dd'))")
    }
    $Query = $Parts -join ' AND '
    if (-not $Name) {
        $Name = 'CIPP-BEC-{0}-{1}' -f ($(if ($CaseId) { $CaseId } else { 'adhoc' })), (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
    }
    $Name = $Name -replace '[^A-Za-z0-9\-_]', '-'
    $ExchangeLocation = if (-not $Locations -or $Locations -contains 'All') { @('All') } else { @($Locations | Where-Object { $_ }) }

    if (-not $PSCmdlet.ShouldProcess($Name, "Create and start content search: $Query")) { return }
    try {
        $null = New-ExoRequest -tenantid $TenantFilter -Compliance -cmdlet 'New-ComplianceSearch' -cmdParams @{
            Name              = $Name
            ExchangeLocation  = $ExchangeLocation
            ContentMatchQuery = $Query
            Description       = "CIPP BEC case $CaseId - created by CIPP; counts only, no content is retrieved by CIPP"
        }
        $null = New-ExoRequest -tenantid $TenantFilter -Compliance -cmdlet 'Start-ComplianceSearch' -cmdParams @{ Identity = $Name }
        $Message = "Created and started content search '$Name' ($Query) across $($ExchangeLocation -join ', ')"
        Write-LogMessage -headers $Headers -API $APIName -tenant $TenantFilter -message $Message -Sev 'Info'
        return [pscustomobject]@{ Name = $Name; Query = $Query; Locations = $ExchangeLocation; Message = $Message }
    } catch {
        $ErrorMessage = Get-CippException -Exception $_
        $Detail = $ErrorMessage.NormalizedError
        if ($Detail -match '(?i)not recognized|access ?denied|unauthori[sz]ed|insufficient|forbidden|role|permission') {
            $Detail = "$Detail. The CIPP-SAM service principal needs a Purview role group that includes Compliance Search (eDiscovery Manager); add it in the Purview portal under Roles and scopes."
        }
        $Message = "Failed to create content search '$Name': $Detail"
        Write-LogMessage -headers $Headers -API $APIName -tenant $TenantFilter -message $Message -Sev 'Error' -LogData $ErrorMessage
        throw $Message
    }
}
