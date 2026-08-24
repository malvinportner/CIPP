function Test-CIPPBecSuperAdmin {
    <#
    .SYNOPSIS
        Tells whether the calling user holds the superadmin role.
    .DESCRIPTION
        Used as the runtime gate for the irreversible Purview purge. Prefers the access context
        Test-CIPPAccess resolved for this request (which already knows about group-based roles), and
        falls back to decoding the client principal header and resolving its roles. Returns $false when
        neither is available, so an unknown caller is never treated as a super admin.
    .PARAMETER Headers
        The request headers.
    .FUNCTIONALITY
        Internal
    #>
    [CmdletBinding()]
    param(
        $Headers
    )

    $Roles = @()
    if ($script:CippAccessUserContext -and $script:CippAccessUserContext.userRoles) {
        $Roles = @($script:CippAccessUserContext.userRoles)
    } elseif ($Headers -and $Headers.'x-ms-client-principal') {
        try {
            $CallingUser = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Headers.'x-ms-client-principal')) | ConvertFrom-Json
            if (($CallingUser.userRoles | Measure-Object).Count -eq 2 -and $CallingUser.userRoles -contains 'authenticated' -and $CallingUser.userRoles -contains 'anonymous') {
                $CallingUser = Test-CIPPAccessUserRole -User $CallingUser
            }
            $Roles = @($CallingUser.userRoles)
        } catch {
            $Roles = @()
        }
    }
    return [bool]($Roles -contains 'superadmin')
}
