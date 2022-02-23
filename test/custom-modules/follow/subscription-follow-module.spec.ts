import { BigNumber } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import '@nomiclabs/hardhat-ethers';
import { expect } from 'chai';
import { MAX_UINT256, ZERO_ADDRESS } from '../../helpers/constants';
import { ERRORS } from '../../helpers/errors';
import {
  getTimestamp,
  matchEvent,
  mine,
  setNextBlockTimestamp,
  waitForTx,
} from '../../helpers/utils';
import { SubscriptionFollowModule__factory } from '../../../typechain-types/factories/SubscriptionFollowModule__factory';
import { SubscriptionFollowModule } from '../../../typechain-types/SubscriptionFollowModule';
import {
  abiCoder,
  currency,
  deployer,
  FIRST_PROFILE_ID,
  governance,
  lensHub,
  lensHubImpl,
  makeSuiteCleanRoom,
  MOCK_FOLLOW_NFT_URI,
  MOCK_PROFILE_HANDLE,
  MOCK_PROFILE_URI,
  moduleGlobals,
  userAddress,
  userTwo,
  userTwoAddress,
} from '../../__setup.spec';

makeSuiteCleanRoom('Subscription Follow Module', function () {
  const DEFAULT_FOLLOW_PRICE = parseEther('10');
  const DEFAULT_SUBSCRIPTION_DURATION = 2592000;

  let subscriptionFollowModule: SubscriptionFollowModule;

  before(async function () {
    subscriptionFollowModule = await new SubscriptionFollowModule__factory(deployer).deploy(
      lensHub.address,
      moduleGlobals.address
    );
  });

  beforeEach(async function () {
    await expect(
      lensHub.connect(governance).whitelistFollowModule(subscriptionFollowModule.address, true)
    ).to.not.be.reverted;

    await expect(
      moduleGlobals.connect(governance).whitelistCurrency(currency.address, true)
    ).to.not.be.reverted;
  });

  context('Negatives', function () {
    context('Initialization', function () {
      it('user should fail to create a profile with subscription follow module using unwhitelisted currency', async function () {
        const followModuleData = abiCoder.encode(
          ['address', 'address', 'uint256', 'uint256'],
          [userAddress, userTwoAddress, DEFAULT_FOLLOW_PRICE, DEFAULT_SUBSCRIPTION_DURATION]
        );

        await expect(
          lensHub.createProfile({
            to: userAddress,
            handle: MOCK_PROFILE_HANDLE,
            imageURI: MOCK_PROFILE_URI,
            followModule: subscriptionFollowModule.address,
            followModuleData: followModuleData,
            followNFTURI: MOCK_FOLLOW_NFT_URI,
          })
        ).to.be.revertedWith(ERRORS.INIT_PARAMS_INVALID);
      });

      it('user should fail to create a profile with subscription follow module using zero recipient', async function () {
        const followModuleData = abiCoder.encode(
          ['address', 'address', 'uint256', 'uint256'],
          [ZERO_ADDRESS, currency.address, DEFAULT_FOLLOW_PRICE, DEFAULT_SUBSCRIPTION_DURATION]
        );

        await expect(
          lensHub.createProfile({
            to: userAddress,
            handle: MOCK_PROFILE_HANDLE,
            imageURI: MOCK_PROFILE_URI,
            followModule: subscriptionFollowModule.address,
            followModuleData: followModuleData,
            followNFTURI: MOCK_FOLLOW_NFT_URI,
          })
        ).to.be.revertedWith(ERRORS.INIT_PARAMS_INVALID);
      });

      it('user should fail to create a profile with subscription follow module using amount lower than max BPS', async function () {
        const followModuleData = abiCoder.encode(
          ['address', 'address', 'uint256', 'uint256'],
          [userAddress, currency.address, 9999, DEFAULT_SUBSCRIPTION_DURATION]
        );

        await expect(
          lensHub.createProfile({
            to: userAddress,
            handle: MOCK_PROFILE_HANDLE,
            imageURI: MOCK_PROFILE_URI,
            followModule: subscriptionFollowModule.address,
            followModuleData: followModuleData,
            followNFTURI: MOCK_FOLLOW_NFT_URI,
          })
        ).to.be.revertedWith(ERRORS.INIT_PARAMS_INVALID);
      });

      it('user should fail to create a profile with subscription follow module using no subscription duration', async function () {
        const followModuleData = abiCoder.encode(
          ['address', 'address', 'uint256', 'uint256'],
          [userAddress, currency.address, DEFAULT_FOLLOW_PRICE, 0]
        );

        await expect(
          lensHub.createProfile({
            to: userAddress,
            handle: MOCK_PROFILE_HANDLE,
            imageURI: MOCK_PROFILE_URI,
            followModule: subscriptionFollowModule.address,
            followModuleData: followModuleData,
            followNFTURI: MOCK_FOLLOW_NFT_URI,
          })
        ).to.be.revertedWith(ERRORS.INIT_PARAMS_INVALID);
      });
    });

    context('Following', function () {
      beforeEach(async function () {
        const followModuleData = abiCoder.encode(
          ['address', 'address', 'uint256', 'uint256'],
          [userAddress, currency.address, DEFAULT_FOLLOW_PRICE, DEFAULT_SUBSCRIPTION_DURATION]
        );
        await expect(
          lensHub.createProfile({
            to: userAddress,
            handle: MOCK_PROFILE_HANDLE,
            imageURI: MOCK_PROFILE_URI,
            followModule: subscriptionFollowModule.address,
            followModuleData: followModuleData,
            followNFTURI: MOCK_FOLLOW_NFT_URI,
          })
        ).to.not.be.reverted;
      });

      it('UserTwo should fail to follow passing a different expected price in data', async function () {
        const data = abiCoder.encode(
          ['address', 'uint256'],
          [currency.address, DEFAULT_FOLLOW_PRICE.div(2)]
        );
        await expect(
          lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])
        ).to.be.revertedWith(ERRORS.MODULE_DATA_MISMATCH);
      });

      it('UserTwo should fail to follow passing a different expected currency in data', async function () {
        const data = abiCoder.encode(['address', 'uint256'], [userAddress, DEFAULT_FOLLOW_PRICE]);
        await expect(
          lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])
        ).to.be.revertedWith(ERRORS.MODULE_DATA_MISMATCH);
      });

      it('UserTwo should fail to follow without first approving module with currency', async function () {
        await expect(currency.mint(userTwoAddress, MAX_UINT256)).to.not.be.reverted;

        const data = abiCoder.encode(
          ['address', 'uint256'],
          [currency.address, DEFAULT_FOLLOW_PRICE]
        );
        await expect(
          lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])
        ).to.be.revertedWith(ERRORS.ERC20_TRANSFER_EXCEEDS_ALLOWANCE);
      });

      it('UserTwo should be deemed as invalid follower after subscription has expired', async function () {
        await expect(currency.mint(userTwoAddress, MAX_UINT256)).to.not.be.reverted;
        await expect(
          currency.connect(userTwo).approve(subscriptionFollowModule.address, MAX_UINT256)
        ).to.not.be.reverted;
        const data = abiCoder.encode(
          ['address', 'uint256'],
          [currency.address, DEFAULT_FOLLOW_PRICE]
        );
        await expect(
          lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])
        ).to.not.be.reverted;

        let currentTimestamp = await getTimestamp();
        await setNextBlockTimestamp(Number(currentTimestamp) + DEFAULT_SUBSCRIPTION_DURATION * 2);
        await mine(1);

        await expect(
          subscriptionFollowModule.validateFollow(FIRST_PROFILE_ID, userTwoAddress, 0)
        ).to.be.reverted;
      });
    });
  });

  context('Scenarios', function () {
    it('User should create a profile with the subscription follow module as the follow module and data, correct events should be emitted', async function () {
      const followModuleData = abiCoder.encode(
        ['address', 'address', 'uint256', 'uint256'],
        [userAddress, currency.address, DEFAULT_FOLLOW_PRICE, DEFAULT_SUBSCRIPTION_DURATION]
      );
      const tx = lensHub.createProfile({
        to: userAddress,
        handle: MOCK_PROFILE_HANDLE,
        imageURI: MOCK_PROFILE_URI,
        followModule: subscriptionFollowModule.address,
        followModuleData: followModuleData,
        followNFTURI: MOCK_FOLLOW_NFT_URI,
      });

      const receipt = await waitForTx(tx);

      expect(receipt.logs.length).to.eq(2);
      matchEvent(receipt, 'Transfer', [ZERO_ADDRESS, userAddress, FIRST_PROFILE_ID], lensHubImpl);
      matchEvent(receipt, 'ProfileCreated', [
        FIRST_PROFILE_ID,
        userAddress,
        userAddress,
        MOCK_PROFILE_HANDLE,
        MOCK_PROFILE_URI,
        subscriptionFollowModule.address,
        followModuleData,
        MOCK_FOLLOW_NFT_URI,
        await getTimestamp(),
      ]);
    });

    it('User should create a profile then set the subscription follow module as the follow module with data, correct events should be emitted', async function () {
      await expect(
        lensHub.createProfile({
          to: userAddress,
          handle: MOCK_PROFILE_HANDLE,
          imageURI: MOCK_PROFILE_URI,
          followModule: ZERO_ADDRESS,
          followModuleData: [],
          followNFTURI: MOCK_FOLLOW_NFT_URI,
        })
      ).to.not.be.reverted;

      const followModuleData = abiCoder.encode(
        ['address', 'address', 'uint256', 'uint256'],
        [userAddress, currency.address, DEFAULT_FOLLOW_PRICE, DEFAULT_SUBSCRIPTION_DURATION]
      );
      const tx = lensHub.setFollowModule(
        FIRST_PROFILE_ID,
        subscriptionFollowModule.address,
        followModuleData
      );

      const receipt = await waitForTx(tx);

      expect(receipt.logs.length).to.eq(1);
      matchEvent(receipt, 'FollowModuleSet', [
        FIRST_PROFILE_ID,
        subscriptionFollowModule.address,
        followModuleData,
        await getTimestamp(),
      ]);
    });

    it('User should create a profile with the subscription follow module as the follow module and data, fetched profile data should be accurate', async function () {
      const followModuleData = abiCoder.encode(
        ['address', 'address', 'uint256', 'uint256'],
        [userAddress, currency.address, DEFAULT_FOLLOW_PRICE, DEFAULT_SUBSCRIPTION_DURATION]
      );
      await expect(
        lensHub.createProfile({
          to: userAddress,
          handle: MOCK_PROFILE_HANDLE,
          imageURI: MOCK_PROFILE_URI,
          followModule: subscriptionFollowModule.address,
          followModuleData: followModuleData,
          followNFTURI: MOCK_FOLLOW_NFT_URI,
        })
      ).to.not.be.reverted;

      const fetchedData = await subscriptionFollowModule.getProfileData(FIRST_PROFILE_ID);
      expect(fetchedData.amount).to.eq(DEFAULT_FOLLOW_PRICE);
      expect(fetchedData.recipient).to.eq(userAddress);
      expect(fetchedData.currency).to.eq(currency.address);
      expect(fetchedData.subscriptionDuration).to.eq(DEFAULT_SUBSCRIPTION_DURATION);
    });

    it('User should create a profile with the subscription follow module as the follow module and data, user two follows, fee distribution is valid, end timestamp is valid', async function () {
      const followModuleData = abiCoder.encode(
        ['address', 'address', 'uint256', 'uint256'],
        [userAddress, currency.address, DEFAULT_FOLLOW_PRICE, DEFAULT_SUBSCRIPTION_DURATION]
      );
      await expect(
        lensHub.createProfile({
          to: userAddress,
          handle: MOCK_PROFILE_HANDLE,
          imageURI: MOCK_PROFILE_URI,
          followModule: subscriptionFollowModule.address,
          followModuleData: followModuleData,
          followNFTURI: MOCK_FOLLOW_NFT_URI,
        })
      ).to.not.be.reverted;

      await expect(currency.mint(userTwoAddress, MAX_UINT256)).to.not.be.reverted;
      await expect(
        currency.connect(userTwo).approve(subscriptionFollowModule.address, MAX_UINT256)
      ).to.not.be.reverted;
      const data = abiCoder.encode(
        ['address', 'uint256'],
        [currency.address, DEFAULT_FOLLOW_PRICE]
      );
      await expect(lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])).to.not.be.reverted;

      expect(await currency.balanceOf(userTwoAddress)).to.eq(
        BigNumber.from(MAX_UINT256).sub(DEFAULT_FOLLOW_PRICE)
      );
      expect(await currency.balanceOf(userAddress)).to.eq(BigNumber.from(DEFAULT_FOLLOW_PRICE));

      const currentTimestamp = await getTimestamp();
      const expectedEndTimestamp = Number(currentTimestamp) + DEFAULT_SUBSCRIPTION_DURATION;
      const actualEndTimestamp = (
        await subscriptionFollowModule.getFollowerData(FIRST_PROFILE_ID, userTwoAddress)
      ).endTimestamp;
      expect(actualEndTimestamp.toNumber()).to.eq(expectedEndTimestamp);
    });

    it('User should create a profile with subscription follow module as the follow module and data, user two follows, user two is a valid follower after half of subscription duration is passed', async function () {
      const followModuleData = abiCoder.encode(
        ['address', 'address', 'uint256', 'uint256'],
        [userAddress, currency.address, DEFAULT_FOLLOW_PRICE, DEFAULT_SUBSCRIPTION_DURATION]
      );
      await expect(
        lensHub.createProfile({
          to: userAddress,
          handle: MOCK_PROFILE_HANDLE,
          imageURI: MOCK_PROFILE_URI,
          followModule: subscriptionFollowModule.address,
          followModuleData: followModuleData,
          followNFTURI: MOCK_FOLLOW_NFT_URI,
        })
      ).to.not.be.reverted;

      await expect(currency.mint(userTwoAddress, MAX_UINT256)).to.not.be.reverted;
      await expect(
        currency.connect(userTwo).approve(subscriptionFollowModule.address, MAX_UINT256)
      ).to.not.be.reverted;
      const data = abiCoder.encode(
        ['address', 'uint256'],
        [currency.address, DEFAULT_FOLLOW_PRICE]
      );
      await expect(lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])).to.not.be.reverted;

      const currentTimestamp = await getTimestamp();
      await setNextBlockTimestamp(Number(currentTimestamp) + DEFAULT_SUBSCRIPTION_DURATION / 2);
      await mine(1);

      await expect(
        subscriptionFollowModule.validateFollow(FIRST_PROFILE_ID, userTwoAddress, 0)
      ).to.not.be.reverted;
    });
  });
});
