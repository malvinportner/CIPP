function New-CIPPBecCollectorResult {
    <#
    .SYNOPSIS
        Builds the uniform result object every BEC collector returns.
    .DESCRIPTION
        Every collector in the BEC check returns { Data, Complete, Cap, Error, Count } so Push-BECRun can
        flatten the data into the report and record an honest completeness marker per collector. A
        collector that hit a paging cap reports Complete=$false with the cap it hit; a collector that
        failed reports Complete=$false with the error text and an empty Data array, so an empty section
        is never mistaken for a clean one.
    .PARAMETER Data
        The collected rows or object. Defaults to an empty array.
    .PARAMETER Complete
        Whether the collector saw everything it asked for. Defaults to $true.
    .PARAMETER Cap
        The cap that was hit (page count, row count) when Complete is $false because of a limit.
    .PARAMETER Error
        Error text when the collector failed.
    .PARAMETER Count
        Number of items in Data; computed when not supplied.
    .FUNCTIONALITY
        Internal
    #>
    [CmdletBinding()]
    param(
        $Data = @(),
        [bool]$Complete = $true,
        $Cap = $null,
        # Exposed to callers as -Error; the variable avoids the $Error automatic variable.
        [Alias('Error')][string]$ErrorText = $null,
        $Count = $null
    )

    if ($null -eq $Data) { $Data = @() }
    if ($null -eq $Count) {
        $Count = if ($Data -is [System.Collections.IEnumerable] -and $Data -isnot [string] -and $Data -isnot [hashtable] -and $Data -isnot [pscustomobject]) { @($Data).Count } elseif ($Data -is [pscustomobject] -or $Data -is [hashtable]) { 1 } else { @($Data).Count }
    }
    if (-not [string]::IsNullOrWhiteSpace($ErrorText)) { $Complete = $false }

    return [pscustomobject]@{
        Data     = $Data
        Complete = [bool]$Complete
        Cap      = $Cap
        Error    = if ([string]::IsNullOrWhiteSpace($ErrorText)) { $null } else { $ErrorText }
        Count    = [int]$Count
    }
}
