// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import {IFollowModule} from '../interfaces/IFollowModule.sol';
import {ILensHub} from '../interfaces/ILensHub.sol';
import {ModuleBase} from '../core/modules/ModuleBase.sol';
import {FeeModuleBase} from '../core/modules/FeeModuleBase.sol';
import {Errors} from '../libraries/Errors.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {IERC721} from '@openzeppelin/contracts/token/ERC721/IERC721.sol';

/**
 * @notice A struct containing the necessary data to execute follow actions on a given profile.
 *
 * @param recipient The recipient address associated with this profile.
 * @param currency The currency associated with this profile.
 * @param amount The following cost associated with this profile.
 * @param subscriptionDuration The unix timestamp which represents duration time.
 */
struct ProfileData {
    address recipient;
    address currency;
    uint256 amount;
    uint256 subscriptionDuration;
}

/**
 * @notice A struct containing the necessary data to store the subscription details of a follower
 *
 * @param endTimestamp The unix timestamp till which the subscription is deemed to be valid.
 */
struct FollowerData {
    uint256 endTimestamp;
}

/**
 * @title SubscriptionFollowModule
 * @author Neel - <device.neel@gmail.com>
 *
 * @notice This is a simple Lens FollowModule implementation, inheriting from the IFollowModule interface,
 * which acts as a subscription-based system.
 */
contract SubscriptionFollowModule is IFollowModule, FeeModuleBase, ModuleBase {
    using SafeERC20 for IERC20;

    error SubscriptionExpired();

    mapping(uint256 => ProfileData) internal _dataByProfile;

    mapping(uint256 => mapping(address => FollowerData)) internal _dataByFollowerByProfile;

    constructor(address hub, address moduleGlobals) FeeModuleBase(moduleGlobals) ModuleBase(hub) {}

    /**
     * @notice This follow module levies a fee on follows.
     *
     * @param data The arbitrary data parameter, decoded into:
     *      address recipient: The custom recipient address to direct earnings to.
     *      address currency: The currency address, must be internally whitelisted.
     *      uint256 amount: The currency total amount to levy.
     *      uint256 duration: The unix timestamp representing duration of subscription
     *
     * @return An abi encoded bytes parameter, which is the same as the passed data parameter.
     */
    function initializeFollowModule(uint256 profileId, bytes calldata data)
        external
        override
        onlyHub
        returns (bytes memory)
    {
        (address recipient, address currency, uint256 amount, uint256 subscriptionDuration) = abi
            .decode(data, (address, address, uint256, uint256));
        if (
            !_currencyWhitelisted(currency) ||
            recipient == address(0) ||
            amount < BPS_MAX ||
            subscriptionDuration == 0
        ) revert Errors.InitParamsInvalid();

        _dataByProfile[profileId].recipient = recipient;
        _dataByProfile[profileId].currency = currency;
        _dataByProfile[profileId].amount = amount;
        _dataByProfile[profileId].subscriptionDuration = subscriptionDuration;
        return data;
    }

    /**
     * @dev Processes a follow by:
     *  1. Charging a fee.
     * @dev Attaches timestamp for the follower up till which subscription
     * would be valid.
     */
    function processFollow(
        address follower,
        uint256 profileId,
        bytes calldata data
    ) external override onlyHub {
        address recipient = _dataByProfile[profileId].recipient;
        address currency = _dataByProfile[profileId].currency;
        uint256 amount = _dataByProfile[profileId].amount;
        uint256 subscriptionDuration = _dataByProfile[profileId].subscriptionDuration;

        _validateDataIsExpected(data, currency, amount);

        _dataByFollowerByProfile[profileId][follower].endTimestamp =
            block.timestamp +
            subscriptionDuration;

        IERC20(currency).safeTransferFrom(follower, recipient, amount);
    }

    /**
     * @dev We don't need to execute any additional logic on transfers in this follow module.
     */
    function followModuleTransferHook(
        uint256 profileId,
        address from,
        address to,
        uint256 followNFTTokenId
    ) external override {}

    /**
     * @dev Checks if the follower is actually following the profile. If thats valid, then
     * checks if the subscription has expired. In case subscription has expired, reverts with
     * a custom `SubscriptionExpired` error.
     */
    function validateFollow(
        uint256 profileId,
        address follower,
        uint256 followNFTTokenId
    ) external view {
        address followNFT = ILensHub(HUB).getFollowNFT(profileId);
        if (followNFT == address(0)) revert Errors.FollowInvalid();
        if (followNFTTokenId == 0) {
            // check that follower owns a followNFT
            if (IERC721(followNFT).balanceOf(follower) == 0) {
                revert Errors.FollowInvalid();
            }
            // if the follower does own a followNFT, check if the
            // subscription has ended
            if (_dataByFollowerByProfile[profileId][follower].endTimestamp < block.timestamp) {
                revert SubscriptionExpired();
            }
        } else {
            // check that follower owns the specific followNFT
            if (IERC721(followNFT).ownerOf(followNFTTokenId) != follower) {
                revert Errors.FollowInvalid();
            }
            // if the follower does own the followNFT, check if the
            // subscription has ended
            if (_dataByFollowerByProfile[profileId][follower].endTimestamp < block.timestamp) {
                revert SubscriptionExpired();
            }
        }
    }

    /**
     * @notice Returns the profile data for a given profile, or an empty struct if that profile was not initialized
     * with this module.
     *
     * @param profileId The token ID of the profile to query.
     *
     * @return The ProfileData struct mapped to that profile.
     */
    function getProfileData(uint256 profileId) external view returns (ProfileData memory) {
        return _dataByProfile[profileId];
    }

    /**
     * @notice Returns the follower data for a given profile, or an empty struct if that profile was not initialized
     * with this module or the follower is not following the passed profile.
     *
     * @param profileId The token ID of the profile to query.
     * @param follower The address of the follower to query.
     *
     * @return The FollowerData struct mapped to that profile + follower combination.
     */
    function getFollowerData(uint256 profileId, address follower)
        external
        view
        returns (FollowerData memory)
    {
        return _dataByFollowerByProfile[profileId][follower];
    }
}
