from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
import pandas as pd
import os
import csv
from collections import Counter, OrderedDict
from datetime import datetime, timedelta

app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = "uploads"
os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

@app.route("/howto")
def howto():
    return render_template("howto.html")

@app.route("/about")
def about():
    return render_template("about.html")

@app.route("/", methods=["GET", "POST"])
def home():
    return render_template("home.html")


@app.route("/bus-lines")
def bus_lines():
    return render_template("bus_lines.html")


@app.route("/api/boardings-data")
def boardings_data():
    """API endpoint to fetch 2024 annual boardings data from CSV"""
    try:
        csv_path = os.path.join("data", "tspr2024_bus_yearline.csv")
        df = pd.read_csv(csv_path)
        
        # Filter for 2024 data
        df_2024 = df[df['CalendarYear'] == 2024]
        
        # Create dictionary with line numbers as keys and annual boardings as values
        boardings_dict = {}
        for _, row in df_2024.iterrows():
            line_name = str(row['Lineno_renamed'])
            boardings = float(row['AnnualBoardings'])
            boardings_dict[line_name] = boardings
        
        return jsonify(boardings_dict)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/daily-boardings-data")
def daily_boardings_data():
    """API endpoint to fetch 2024 daily boardings data (Weekday, Saturday, Sunday/Holiday)"""
    try:
        csv_path = os.path.join("data", "tspr2024_bus_yearline.csv")
        df = pd.read_csv(csv_path)
        
        # Filter for 2024 data
        df_2024 = df[df['CalendarYear'] == 2024]
        
        # Create dictionary with line numbers as keys and daily boardings data as values
        daily_boardings_dict = {}
        for _, row in df_2024.iterrows():
            line_name = str(row['Lineno_renamed'])
            # Convert NaN to None (which becomes null in JSON)
            weekday_val = None if pd.isna(row['AVG_Daily_Boardings_MF']) else float(row['AVG_Daily_Boardings_MF'])
            saturday_val = None if pd.isna(row['AVG_Daily_Boardings_Sat']) else float(row['AVG_Daily_Boardings_Sat'])
            sunday_val = None if pd.isna(row['AVG_Daily_Boardings_SunHol']) else float(row['AVG_Daily_Boardings_SunHol'])
            
            daily_boardings_dict[line_name] = {
                'weekday': weekday_val,
                'saturday': saturday_val,
                'sunday': sunday_val
            }
        
        return jsonify(daily_boardings_dict)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/hours-data")
def hours_data():
    """API endpoint to fetch 2024 revenue and service hours data"""
    try:
        csv_path = os.path.join("data", "tspr2024_bus_yearline.csv")
        df = pd.read_csv(csv_path)
        
        # Filter for 2024 data
        df_2024 = df[df['CalendarYear'] == 2024]
        
        # Create dictionary with line numbers as keys and hours data as values
        hours_dict = {}
        for _, row in df_2024.iterrows():
            line_name = str(row['Lineno_renamed'])
            # Convert NaN to None (which becomes null in JSON)
            revenue_hours = None if pd.isna(row['Annual_Revenue_Hours']) else float(row['Annual_Revenue_Hours'])
            service_hours = None if pd.isna(row['Annual_Service_Hours']) else float(row['Annual_Service_Hours'])
            
            hours_dict[line_name] = {
                'revenue': revenue_hours,
                'service': service_hours
            }
        
        return jsonify(hours_dict)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/stations")
def stations():
    return render_template("stations.html")


@app.route("/greater-less")
def greater_less():
    return render_template("greater_less.html")


@app.route("/similar-to")
def similar_to():
    return render_template("similar_to.html")


if __name__ == "__main__":
    app.run(debug=True)
