package finalizers

import (
	"context"

	"github.com/certusone/wormhole/node/pkg/watchers/evm/connectors"

	"go.uber.org/zap"
)

// OptimismFinalizer implements the finality check for Optimism.
// Optimism provides a special "rollup_getInfo" API call to determine the latest L2 (Optimism) block to be published on the L1 (Ethereum).
// This finalizer polls that API to determine if a block is finalized.

type OptimismFinalizer struct {
	logger    *zap.Logger
	connector connectors.Connector
}

func NewOptimismFinalizer(ctx context.Context, logger *zap.Logger, connector connectors.Connector) *OptimismFinalizer {
	return &OptimismFinalizer{
		logger:    logger,
		connector: connector,
	}
}

func (f *OptimismFinalizer) IsBlockFinalized(ctx context.Context, block *connectors.NewBlock) (bool, error) {
	type Result struct {
		Mode       string
		EthContext struct {
			BlockNumber uint64 `json:"blockNumber"`
			TimeStamp   uint64 `json:"timestamp"`
		} `json:"ethContext"`
		RollupContext struct {
			Index         uint64 `json:"index"`
			VerifiedIndex uint64 `json:"verifiedIndex"`
		} `json:"rollupContext"`
	}

	var m Result
	err := f.connector.RawCallContext(ctx, &m, "rollup_getInfo")
	if err != nil {
		f.logger.Error("failed to get rollup info", zap.String("eth_network", f.connector.NetworkName()), zap.Error(err))
		return false, err
	}

	// f.logger.Info("got rollup info", zap.String("eth_network", f.connector.NetworkName()),
	// 	zap.String("mode", m.Mode),
	// 	zap.Uint64("l1_blockNumber", m.EthContext.BlockNumber),
	// 	zap.Uint64("l2_blockNumber", m.RollupContext.Index),
	// 	zap.Uint64("verified_index", m.RollupContext.VerifiedIndex),
	// 	zap.Stringer("desired_block", block.Number),
	// )

	return block.Number.Uint64() <= m.RollupContext.Index, nil
}

/*
curl -X POST --data '{"jsonrpc":"2.0","method":"rollup_getInfo","params":[],"id":1}' https://rpc.ankr.com/optimism_testnet
{
	"jsonrpc":"2.0","id":1,"result":{
		"mode":"verifier",
		"syncing":false,
		"ethContext":{
			"blockNumber":7763392,"timestamp":1665680949 // This is a few blocks behind the latest block on goerli.
			},
		"rollupContext":{
			"index":1952690,"queueIndex":13285,"verifiedIndex":0 // This is a few blocks behind the latest block on optimism.
		}
	}
}
*/
