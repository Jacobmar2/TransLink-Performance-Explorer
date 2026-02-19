import pandas as pd
df = pd.read_csv('data/tspr2024_bus_yearline.csv')
df_2024 = df[df['CalendarYear'] == 2024]

# Check for NaN values in the daily boardings columns
daily_cols = ['AVG_Daily_Boardings_MF', 'AVG_Daily_Boardings_Sat', 'AVG_Daily_Boardings_SunHol']
for col in daily_cols:
    nan_count = df_2024[col].isna().sum()
    print(f'{col}: {nan_count} NaN values')
    if nan_count > 0:
        print(f'  Rows with NaN: {df_2024[df_2024[col].isna()]["Lineno_renamed"].tolist()}')

# Check if values are numeric
print('\nData types:')
for col in daily_cols:
    print(f'{col}: {df_2024[col].dtype}')

# Check some actual values
print('\nSample values:')
for idx, row in df_2024[df_2024['Lineno_renamed'] == '2'].iterrows():
    print(f'Line 2 - Weekday: {row["AVG_Daily_Boardings_MF"]}, Sat: {row["AVG_Daily_Boardings_Sat"]}, Sun: {row["AVG_Daily_Boardings_SunHol"]}')
